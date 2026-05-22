const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const { recalculateAllPoints } = require('./pointsService');
const { trySaveDailyPoints } = require('./dailyHistoryService');

const API_KEY = process.env.API_FOOTBALL_KEY;
const headers = { Authorization: `Token ${API_KEY}` };

const statusMap = {
  notstarted: 'scheduled',
  inprogress: '1_tempo',
  '1st_half': '1_tempo',
  halftime: 'intervalo',
  '2nd_half': '2_tempo',
  extra_time: 'prorrogacao',
  'extra_time_first_half': '1_tet',
  'extra_time_second_half': '2_tet',
  penalties: 'penaltis',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled'
};

// --- FUNÇÕES AUXILIARES ---

function mapPlayer(p) {
  return {
    id: p.player_id || null,
    api_id: p.api_id || null,
    nome: p.name || "Desconhecido",
    numero: p.jersey_number || null,
    posicao: p.position || null,
    posicaoDetalhada: p.specific_position || null,
    entrou: p.sub_in || null,
    saiu: p.sub_out || null,
    amarelo: p.yellow_card || false,
    vermelho: p.red_card || false,
    gols: p.goals || 0
  };
}

function sortByPosition(players) {
  const ordem = { G: 0, D: 1, M: 2, F: 3 };
  return players.sort((a, b) => (ordem[a.posicao] ?? 9) - (ordem[b.posicao] ?? 9));
}

function mapLineupTeam(team) {
  if (!team) return { formation: "", players: [], substitutes: [] };
  return {
    formation: team.formation || "",
    players: sortByPosition((team.players || []).map(mapPlayer)),
    substitutes: (team.substitutes || []).map(mapPlayer)
  };
}

/**
 * 🎯 Extrai o placar e a sequência detalhada (gol, defesa, erro) do shotmap
 */
function extractPenaltyDetailed(shotmap) {
  if (!shotmap || !Array.isArray(shotmap)) return { home: null, away: null, sequence: [] };
  const shootoutShots = shotmap.filter(s => s.sit === 'shootout').sort((a, b) => a.min - b.min);
  if (shootoutShots.length === 0) return { home: null, away: null, sequence: [] };

  let hPen = 0, aPen = 0;
  const sequence = shootoutShots.map(s => {
    if (s.type === 'goal') { s.home ? hPen++ : aPen++; }
    return { home: s.home, type: s.type, player_id: s.pid, min: s.min };
  });
  return { home: hPen, away: aPen, sequence };
}

// --- CORE UPDATER ---

async function updateMatches() {
  try {
    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) return;
    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 286400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    // 1. LIVE (Com spatial=true para pegar shotmap de pênaltis)
    try {
      const liveRes = await axios.get(`https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza&spatial=true`, { headers, timeout: 10000 });
      if (liveRes.data?.results) await processGameList(liveRes.data.results, allowedLeagues, robotSettings, 'LIVE');
    } catch (e) { console.error(`❌ [LIVE]: ${e.message}`); }

    // 2. EVENTS (Com spatial=true)
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza&full=true&spatial=true`;

    while (nextUrl) {
      try {
        const response = await axios.get(nextUrl, { headers, timeout: 15000 });
        if (response.data?.results) await processGameList(response.data.results, allowedLeagues, robotSettings, 'EVENTS');
        nextUrl = response.data.next;
      } catch (e) { console.error(`❌ [EVENTS]: ${e.message}`); nextUrl = null; }
    }
    await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });
  } catch (err) { console.error('❌ [Global]:', err); }
}

async function processGameList(games, allowedLeagues, robotSettings, source) {
  for (const gameData of games) {
    try {
      if (!gameData.league?.id || !allowedLeagues.includes(gameData.league.id)) continue;
      const match = await Match.findOne({ apiId: gameData.id });
      if (!match) continue;

      // 🚨 TRAVA DE SEGURANÇA: Se o jogo já está como finalizado no seu banco,
      // ele ignora as próximas linhas e pula para o próximo jogo da lista, zerando o tráfego.
      if (match.status === 'finished') continue;

      let gameDetail = { ...gameData };
      const newStatus = statusMap[gameDetail.status] || 'scheduled';
      const statusChanged = match.status !== newStatus;
      // --- TRAVA DE GRADE E AUDITORIA ---
      if (match.status === 'scheduled' && !['scheduled', 'cancelled'].includes(newStatus)) {
        const configId = `league_${match.leagueId || 1}`;
        const lockIdentifier = match.phaseName || match.group;
        const settingsUpdated = await Settings.findOneAndUpdate(
          { _id: configId, lockedPhases: { $ne: lockIdentifier } },
          {
            $addToSet: { lockedPhases: lockIdentifier, unlockedPhases: { $each: [lockIdentifier, 'podium'] } },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
          }, { new: true }
        );
        if (settingsUpdated) {
          auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier).then(async (csv) => {
            if (!csv) return;
            const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
            const emails = users.map(u => u.email).filter(e => !!e);
            if (emails.length > 0) await emailService.sendBroadcastEmail(emails, `🔒 Auditoria: ${lockIdentifier}`, "Trancado.", csv);
          }).catch(e => console.error("Audit Err:", e.message));
        }
      }

      // --- BUSCA DETALHE SE NÃO TEM ESCALAÇÃO ---
      if (!(match.lineups?.home?.players?.length > 0)) {
        try {
          const detailRes = await axios.get(`https://sports.bzzoiro.com/api/events/${gameDetail.id}/?spatial=true`, { headers, timeout: 8000 });
          if (detailRes.data?.lineups) gameDetail = detailRes.data;
        } catch (err) { console.error(`❌ DETAIL ERROR ${gameDetail.id}`); }
      }

      // --- LÓGICA DE PÊNALTIS (REDUNDÂNCIA) ---
      let penA = gameDetail.penalty_shootout?.home ?? null;
      let penB = gameDetail.penalty_shootout?.away ?? null;
      let shootoutSequence = [];

      if (gameDetail.shotmap) {
        const detailed = extractPenaltyDetailed(gameDetail.shotmap);
        if (detailed.home !== null) {
          if (penA === null) { penA = detailed.home; penB = detailed.away; }
          shootoutSequence = detailed.sequence;
        }
      }

      const updateData = {
        scoreA: gameDetail.home_score,
        scoreB: gameDetail.away_score,
        status: newStatus,
        minute: gameDetail.current_minute ? `${gameDetail.current_minute}'` : match.minute,
        penaltiesA: penA,
        penaltiesB: penB,
        shootoutDetail: shootoutSequence,
        xg: {
          home: parseFloat(gameDetail.actual_home_xg || gameDetail.home_xg_live || 0),
          away: parseFloat(gameDetail.actual_away_xg || gameDetail.away_xg_live || 0)
        }
      };

      // --- CLASSIFICAÇÃO (PRIORIDADE PÊNALTIS) ---
      const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
      if (isKnockout) {
        if (penA !== null && penB !== null && penA !== penB) {
          updateData.qualifiedSide = penA > penB ? 'A' : 'B';
        } else if (updateData.scoreA !== updateData.scoreB) {
          updateData.qualifiedSide = updateData.scoreA > updateData.scoreB ? 'A' : 'B';
        }
      }

      // Estatísticas
      if (gameDetail.live_stats) {
        updateData.statistics = gameDetail.live_stats;
        updateData.possession = {
          home: Number(gameDetail.live_stats.home?.ball_possession) || 0,
          away: Number(gameDetail.live_stats.away?.ball_possession) || 0
        };
      }

      // --- ESCALAÇÕES ---
      const apiTotal = (gameDetail.lineups?.home?.players?.length || 0) + (gameDetail.lineups?.home?.substitutes?.length || 0);
      if (apiTotal > 0) {
        const dbTotal = (match.lineups?.home?.players?.length || 0) + (match.lineups?.home?.substitutes?.length || 0);
        if (!(match.lineups?.home?.players?.length > 0) || apiTotal > dbTotal) {
          updateData.lineups = { home: mapLineupTeam(gameDetail.lineups.home), away: mapLineupTeam(gameDetail.lineups.away), confirmed: gameDetail.lineups?.confirmed || false };
        } else if (['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'finished'].includes(newStatus)) {
          const updateSide = async (side) => {
            const all = [...(gameDetail.lineups[side].players || []), ...(gameDetail.lineups[side].substitutes || [])];
            for (const p of all) {
              if (p.sub_out || p.sub_in || p.goals > 0 || p.yellow_card || p.red_card) {
                const r = await Match.updateOne({ _id: match._id, [`lineups.${side}.players.id`]: p.player_id }, { $set: { [`lineups.${side}.players.$.saiu`]: p.sub_out, [`lineups.${side}.players.$.entrou`]: p.sub_in, [`lineups.${side}.players.$.amarelo`]: p.yellow_card, [`lineups.${side}.players.$.vermelho`]: p.red_card, [`lineups.${side}.players.$.gols`]: p.goals, [`lineups.${side}.players.$.rating`]: p.rating } });
                if (r.modifiedCount === 0) await Match.updateOne({ _id: match._id, [`lineups.${side}.substitutes.id`]: p.player_id }, { $set: { [`lineups.${side}.substitutes.$.saiu`]: p.sub_out, [`lineups.${side}.substitutes.$.entrou`]: p.sub_in, [`lineups.${side}.substitutes.$.amarelo`]: p.yellow_card, [`lineups.${side}.substitutes.$.vermelho`]: p.red_card, [`lineups.${side}.substitutes.$.gols`]: p.goals, [`lineups.${side}.substitutes.$.rating`]: p.rating } });
              }
            }
          };
          await updateSide('home'); await updateSide('away');
        }
      }

      // --- INCIDENTES ---
      if (Array.isArray(gameDetail.incidents)) {
        updateData.goalsDetail = gameDetail.incidents.map(i => ({
          type: i.type, name: i.player_name || i.player || i.player_out || 'Lance',
          min: i.minute, extra: i.extra_minute || i.length || null,
          side: i.is_home ? 'home' : 'away',
          description: i.card_type || i.goal_type || i.decision || i.subtype || '',
          playerIn: i.player_in || null, playerOut: i.player_out || null
        }));
      }

      await Match.updateOne({ _id: match._id }, { $set: updateData });
      if (statusChanged && newStatus === 'finished') {
        const tid = match.leagueId || '1';
        recalculateAllPoints(tid).then(() => trySaveDailyPoints(gameDetail.event_date, tid)).catch(() => {});
      }
    } catch (err) { console.error(`❌ [Erro jogo ${gameData.id}]:`, err.message); }
  }
}

module.exports = updateMatches;
