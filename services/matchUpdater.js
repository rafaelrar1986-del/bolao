const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const { recalculateAllPoints } = require('./pointsService');
const { trySaveDailyPoints } = require('./dailyHistoryService');

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const headers = { Authorization: `Token ${API_KEY}` };

const statusMap = {
  notstarted: 'scheduled',
  inprogress: '1_tempo',
  '1st_half': '1_tempo',
  halftime: 'intervalo',
  '2nd_half': '2_tempo',
  extra_time: 'prorrogacao',
  extra_time_first_half: '1_tet',
  extra_time_second_half: '2_tet',
  penalties: 'penaltis',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled'
};

// --- FUNÇÕES AUXILIARES ---

function mapPlayer(p) {
  return {
    id: p.player_id || null,
    api_id: p.player_id || null, // V2 unificou e estabilizou os IDs primários como player_id
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
 * 🎯 Extrai o placar e a sequência detalhada do shotmap caso o penalty_shootout falhe na V2
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
    const tomorrow = new Date(now - 86400000).toISOString().split('T')[0];

    // 1. LIVE (Consumindo a rota leve de tempo real da V2)
    try {
      const liveRes = await axios.get(`${BASE_URL}/events/live/?tz=America/Fortaleza`, { headers, timeout: 10000 });
      if (liveRes.data?.events) {
        await processGameList(liveRes.data.events, allowedLeagues, robotSettings, 'LIVE');
      }
    } catch (e) { console.error(`❌ [LIVE V2]: ${e.message}`); }

    // 2. EVENTS (Listagem geral por período na V2)
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `${BASE_URL}/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza`;

    while (nextUrl) {
      try {
        const response = await axios.get(nextUrl, { headers, timeout: 15000 });
        if (response.data?.results) {
          await processGameList(response.data.results, allowedLeagues, robotSettings, 'EVENTS');
        }
        nextUrl = response.data.next;
      } catch (e) { console.error(`❌ [EVENTS V2]: ${e.message}`); nextUrl = null; }
    }
    await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });
  } catch (err) { console.error('❌ [Global V2]:', err); }
}

async function processGameList(games, allowedLeagues, robotSettings, source) {
  for (const gameData of games) {
    try {
      if (!gameData.league_id || !allowedLeagues.includes(gameData.league_id)) continue;
      const match = await Match.findOne({ apiId: gameData.id });
      if (!match) continue;

      const newStatus = statusMap[gameData.status] || 'scheduled';

      // 🚨 TRAVA TOTAL ANTI-REPROCESSAMENTO (Otimização Render Free)
      if (
        match.status === 'finished' && 
        newStatus === 'finished' && 
        match.scoutsConsolidated === true &&
        match.apiLastUpdated === gameData.last_updated
      ) {
        continue; 
      }

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

      // --- ESTRUTURA BASE DE ATUALIZAÇÃO DA RODADA ---
      const updateData = {
        scoreA: gameData.home_score,
        scoreB: gameData.away_score,
        status: newStatus,
        minute: gameData.current_minute ? `${gameData.current_minute}'` : match.minute,
        apiLastUpdated: gameData.last_updated || null,
        penaltiesA: gameData.penalty_shootout?.home ?? null,
        penaltiesB: gameData.penalty_shootout?.away ?? null,
        shootoutDetail: match.shootoutDetail || []
      };

      // --- DETERMINAÇÃO DE GATILHO PARA SUB-RECURSOS ---
      const isLiveWindow = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'penaltis', 'prorrogacao'].includes(newStatus);
      const isFirstTimeFinished = (newStatus === 'finished' && !match.scoutsConsolidated);

      if (isLiveWindow || isFirstTimeFinished) {
        
        // 1. INCIDENTES (Sub-recurso focado da V2)
        try {
          const incRes = await axios.get(`${BASE_URL}/events/${gameData.id}/incidents/`, { headers, timeout: 8000 });
          if (Array.isArray(incRes.data?.incidents)) {
            updateData.goalsDetail = incRes.data.incidents.map(i => ({
              type: i.type, 
              name: i.player_name || i.player || 'Lance',
              min: i.minute, 
              extra: i.injuryTime || null,
              side: i.is_home ? 'home' : 'away',
              description: i.card_type || i.goal_type || i.decision || '',
              playerIn: i.player_in || null, 
              playerOut: i.player_out || null
            }));
          }
        } catch (err) { console.error(`❌ INCIDENTS ERROR ${gameData.id}`); }

        // 2. ESCALAÇÕES (Sub-recurso focado da V2)
        try {
          const lineupsRes = await axios.get(`${BASE_URL}/events/${gameData.id}/lineups/`, { headers, timeout: 8000 });
          if (lineupsRes.data?.lineups) {
            updateData.lineups = { 
              home: mapLineupTeam(lineupsRes.data.lineups.home), 
              away: mapLineupTeam(lineupsRes.data.lineups.away), 
              confirmed: lineupsRes.data.lineup_status === 'confirmed'
            };
          }
        } catch (err) { console.error(`❌ LINEUPS ERROR ${gameData.id}`); }

        // 3. ESTATÍSTICAS E REDUNDÂNCIA DE PÊNALTIS (Sub-recurso de Estatísticas e Shotmap da V2)
        try {
          const statsRes = await axios.get(`${BASE_URL}/events/${gameData.id}/stats/`, { headers, timeout: 8000 });
          if (statsRes.data) {
            const liveStats = statsRes.data;
            updateData.statistics = liveStats;
            
            if (liveStats.stats?.home && liveStats.stats?.away) {
              updateData.possession = {
                home: Number(liveStats.stats.home.ball_possession) || 0,
                away: Number(liveStats.stats.away.ball_possession) || 0
              };
              updateData.xg = {
                home: parseFloat(liveStats.stats.home.xg?.actual || liveStats.stats.home.xg || 0),
                away: parseFloat(liveStats.stats.away.xg?.actual || liveStats.stats.away.xg || 0)
              };
            }

            // MANTIDO: Varredura detalhada do shotmap para redundância caso 'penalty_shootout' falhe
            if (liveStats.shotmap) {
              const detailed = extractPenaltyDetailed(liveStats.shotmap);
              if (detailed.home !== null) {
                if (updateData.penaltiesA === null) { 
                  updateData.penaltiesA = detailed.home; 
                  updateData.penaltiesB = detailed.away; 
                }
                updateData.shootoutDetail = detailed.sequence;
              }
            }
          }
        } catch (err) { console.error(`❌ STATS/SHOTMAP ERROR ${gameData.id}`); }
      }

      // --- CLASSIFICAÇÃO MATA-MATA (Mantida intacta) ---
      const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
      if (isKnockout) {
        if (updateData.penaltiesA !== null && updateData.penaltiesB !== null && updateData.penaltiesA !== updateData.penaltiesB) {
          updateData.qualifiedSide = updateData.penaltiesA > updateData.penaltiesB ? 'A' : 'B';
        } else if (updateData.scoreA !== updateData.scoreB) {
          updateData.qualifiedSide = updateData.scoreA > updateData.scoreB ? 'A' : 'B';
        }
      }

      // Ativação da trava final se a partida encerrou
      if (newStatus === 'finished') {
        updateData.scoutsConsolidated = true;
      }

      // 🔥 PERSISTÊNCIA COMPACTADA: Apenas uma transação de gravação no Mongo
      await Match.updateOne({ _id: match._id }, { $set: updateData });

      // Dispara recálculo de pontos uma única vez na transição de status
      if (statusChanged && newStatus === 'finished') {
        const tid = match.leagueId || '1';
        recalculateAllPoints(tid).then(() => trySaveDailyPoints(gameData.event_date, tid)).catch(() => {});
      }
    } catch (err) { console.error(`❌ [Erro jogo ${gameData.id}]:`, err.message); }
  }
}

module.exports = updateMatches;
