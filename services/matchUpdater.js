const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const { recalculateAllPoints } = require('./pointsService');
const { trySaveDailyPoints } = require('./dailyHistoryService');

const API_KEY = process.env.API_FOOTBALL_KEY;

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

function extractIncidents(incidents) {
  if (!incidents) return [];
  try {
    return incidents.map(i => ({
      type: i.type,
      name: i.player_name || i.player || 'Jogador',
      min: i.minute,
      extra: i.extra_minute || null,
      side: i.is_home ? 'home' : 'away',
      description: i.subtype_name || i.subtype || '', 
      playerIn: i.player_in_name || null,
      playerOut: i.player_out_name || null
    }));
  } catch (err) {
    console.error(`❌ [Erro extractIncidents]: Erro ao processar array de incidentes:`, err.message);
    return [];
  }
}

function extractStats(stats) {
  const result = { possession: { home: 0, away: 0 }, detailed: [] };
  if (!stats) return result;
  try {
    result.detailed = stats; 
    const poss = stats.find(s => s.type === 'Ball Possession');
    if (poss) {
      result.possession.home = parseInt(poss.home) || 0;
      result.possession.away = parseInt(poss.away) || 0;
    }
  } catch (err) {
    console.error(`❌ [Erro extractStats]: Falha ao processar estatísticas:`, err.message);
  }
  return result;
}

function determineQualifier(game) {
  if (game.home_score > game.away_score) return 'A';
  if (game.away_score > game.home_score) return 'B';
  const penHome = game.penalty_shootout?.home || 0;
  const penAway = game.penalty_shootout?.away || 0;
  if (penHome > penAway) return 'A';
  if (penAway > penHome) return 'B';
  return null;
}

async function updateMatches() {
  try {
    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) {
      console.error('❌ [Critical]: Settings "league_1" não encontrada no Banco de Dados.');
      return;
    }

    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) {
      console.log('⚠️ [Updater]: Nenhuma liga configurada em api_leagues.');
      return;
    }

    const now = Date.now();
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    // 1️⃣ --- BUSCA LIVE ---
    console.log(`📡 [Live] Requisitando: spatial=true`);
    try {
      const liveRes = await axios.get(`https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza&spatial=true`, {
        headers: { Authorization: `Token ${API_KEY}` },
        timeout: 10000
      });
      await processGameList(liveRes.data.results, allowedLeagues, "LIVE", robotSettings);
    } catch (e) {
      console.error(`❌ [Erro API LIVE]: ${e.message}`);
    }

    // 2️⃣ --- BUSCA EVENTS ---
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza&spatial=true`;

    while (nextUrl) {
      try {
        console.log(`🔍 [Events] Buscando página: ${nextUrl}`);
        const response = await axios.get(nextUrl, {
          headers: { Authorization: `Token ${API_KEY}` },
          timeout: 15000
        });
        await processGameList(response.data.results, allowedLeagues, "EVENTS", robotSettings);
        nextUrl = response.data.next;
      } catch (e) {
        console.error(`❌ [Erro API EVENTS]: Falha na página ${nextUrl} - ${e.message}`);
        nextUrl = null; // Interrompe para não entrar em loop infinito se for erro de rede
      }
    }

    await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });

  } catch (err) {
    console.error('❌ [Erro Global Updater]:', err);
  }
}

async function processGameList(games, allowedLeagues, source, robotSettings) {
  if (!games || !Array.isArray(games)) return;

  for (const game of games) {
    try {
      if (!allowedLeagues.includes(game.league?.id)) continue;

      const match = await Match.findOne({ apiId: game.id });
      if (!match) {
        // Log leve, apenas para saber que um jogo da API não está no seu banco
        // console.log(`ℹ️ [Info]: Jogo API ID ${game.id} não encontrado no banco.`);
        continue;
      }

      const newStatus = statusMap[game.status] || 'scheduled';
      const newMinute = game.current_minute ? `${game.current_minute}'` : '';
      const newPenA = game.penalty_shootout?.home ?? null;
      const newPenB = game.penalty_shootout?.away ?? null;

      let autoQualifiedSide = match.qualifiedSide;
      const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
      
      if (isKnockout && newStatus === 'finished' && !match.qualifiedSide) {
         autoQualifiedSide = determineQualifier(game);
      }

      // --- LÓGICA DE AUDITORIA ---
      if (match.status === 'scheduled' && !['scheduled', 'cancelled', 'postponed'].includes(newStatus)) {
        const configId = `league_${match.leagueId || 1}`;
        const lockIdentifier = match.phaseName || match.group;
        const isAlreadyLocked = robotSettings.lockedPhases && robotSettings.lockedPhases.includes(lockIdentifier);

        if (!isAlreadyLocked) {
          console.log(`🛡️ [Bloqueio]: Iniciando trava para ${lockIdentifier} (${match.teamA} x ${match.teamB})`);
          await Settings.findByIdAndUpdate(configId, {
            $addToSet: { 
              lockedPhases: lockIdentifier,
              unlockedPhases: { $each: [lockIdentifier, 'podium'] } 
            },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true } 
          });

          try {
            const csvFile = await auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier);
            if (csvFile) {
              const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
              const emails = users.map(u => u.email).filter(e => !!e);
              if (emails.length > 0) {
                await emailService.sendBroadcastEmail(emails, `🔒 Auditoria: Grade ${lockIdentifier} Trancada`, "Palpites trancados.", csvFile);
                console.log(`📧 [E-mail]: Auditoria enviada para ${emails.length} usuários.`);
              }
            }
          } catch (auditErr) { 
            console.error(`❌ [Erro Auditoria]: Falha ao gerar/enviar CSV para ${lockIdentifier}:`, auditErr.message); 
          }
          robotSettings.lockedPhases.push(lockIdentifier);
        }
      }

      // --- ATUALIZAÇÃO ---
      const isLive = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', 'penaltis'].includes(newStatus);
      const scoreChanged = match.scoreA !== game.home_score || match.scoreB !== game.away_score;
      const statusChanged = match.status !== newStatus;
      
      // Atualiza se houver mudança relevante ou se estiver ao vivo (para manter incidentes/minuto atualizados)
      if (scoreChanged || statusChanged || isLive || newStatus === 'finished') {
        const oldStatus = match.status;
        
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.minute = newMinute; 
        match.penaltiesA = newPenA;
        match.penaltiesB = newPenB;
        match.qualifiedSide = autoQualifiedSide;
        match.apiStatus = game.status_short || 'NS';

        // Incidentes, Stats e Lineups
        match.goalsDetail = extractIncidents(game.incidents);
        const statsData = extractStats(game.stats);
        match.possession = statsData.possession;
        match.statistics = statsData.detailed;

        if (game.lineups) {
          match.lineups = {
            home: game.lineups.home || {},
            away: game.lineups.away || {}
          };
        }

        await match.save();

        if (scoreChanged) console.log(`⚽ GOL [${source}]: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB}`);

        if (oldStatus !== 'finished' && newStatus === 'finished') {
          console.log(`🏁 [Finalizado]: ${match.teamA} x ${match.teamB}. Iniciando processamento de pontos...`);
          const targetLeagueId = match.leagueId || '1';
          try {
            await recalculateAllPoints(targetLeagueId); 
            await trySaveDailyPoints(game.event_date);
            console.log(`✅ [Pontos]: Sucesso para Liga ${targetLeagueId}`);
          } catch (err) { 
            console.error(`❌ [Erro Processamento Pontos]: Match API ID ${game.id}:`, err.message); 
          }
        }
      }
    } catch (gameErr) {
      console.error(`❌ [Erro Crítico no Jogo API ID ${game.id}]:`, gameErr);
    }
  }
}

module.exports = updateMatches;
