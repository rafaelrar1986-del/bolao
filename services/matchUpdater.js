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

/**
 * CORE DO UPDATER - Sincronizado com MatchSchema e Spatial Data
 */
async function updateMatches() {
  try {
    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) return;

    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    // 1️⃣ BUSCA LIVE (Rápida)
    try {
      const liveRes = await axios.get(`https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza&spatial=true`, { headers, timeout: 10000 });
      if (liveRes.data?.results) {
        await processGameList(liveRes.data.results, allowedLeagues, robotSettings, true);
      }
    } catch (e) {
      console.error(`❌ [Erro API LIVE]: ${e.message}`);
    }

    // 2️⃣ BUSCA EVENTS (Sincronização Completa)
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza&spatial=true`;

    while (nextUrl) {
      try {
        const response = await axios.get(nextUrl, { headers, timeout: 15000 });
        if (response.data?.results) {
          await processGameList(response.data.results, allowedLeagues, robotSettings, false);
        }
        nextUrl = response.data.next;
      } catch (e) {
        console.error(`❌ [Erro API EVENTS]: ${e.message}`);
        nextUrl = null;
      }
    }

    await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });
  } catch (err) {
    console.error('❌ [Erro Global Updater]:', err);
  }
}

async function processGameList(games, allowedLeagues, robotSettings, isFastLive = false) {
  if (!games || !Array.isArray(games)) return;

  for (let game of games) {
    try {
      if (!allowedLeagues.includes(game.league?.id)) continue;

      const match = await Match.findOne({ apiId: game.id });
      if (!match) continue;

      const newStatus = statusMap[game.status] || 'scheduled';
      const statusChanged = match.status !== newStatus;

      // --- 🛡️ AUDITORIA E BLOQUEIO ---
      if (match.status === 'scheduled' && !['scheduled', 'cancelled', 'postponed'].includes(newStatus)) {
        const configId = `league_${match.leagueId || 1}`;
        const lockIdentifier = match.phaseName || match.group;
        const isAlreadyLocked = robotSettings.lockedPhases?.includes(lockIdentifier);

        if (!isAlreadyLocked) {
          await Settings.findByIdAndUpdate(configId, {
            $addToSet: { lockedPhases: lockIdentifier, unlockedPhases: { $each: [lockIdentifier, 'podium'] } },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
          });

          auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier).then(async (csvFile) => {
            if (csvFile) {
              const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
              const emails = users.map(u => u.email).filter(e => !!e);
              if (emails.length > 0) {
                await emailService.sendBroadcastEmail(emails, `🔒 Auditoria: ${lockIdentifier}`, "Palpites trancados.", csvFile);
              }
            }
          }).catch(e => console.error("❌ [Audit Error]:", e.message));
        }
      }

      // --- 🚀 ENRIQUECIMENTO (SPATIAL) ---
      if (!isFastLive && newStatus !== 'scheduled' && !game.live_stats) {
        try {
          const detailRes = await axios.get(`https://sports.bzzoiro.com/api/events/${game.id}/?spatial=true`, { headers, timeout: 8000 });
          if (detailRes.data) game = detailRes.data;
        } catch (err) {}
      }

      // --- 📝 ATUALIZAÇÃO DO MATCH MODEL ---
      match.scoreA = game.home_score;
      match.scoreB = game.away_score;
      match.status = newStatus;
      match.minute = game.current_minute ? `${game.current_minute}'` : '';
      match.penaltiesA = game.penalty_shootout?.home ?? null;
      match.penaltiesB = game.penalty_shootout?.away ?? null;

      // xG e Odds (Alinhado ao novo Schema)
      match.xg = {
        home: parseFloat(game.actual_home_xg || game.home_xg_live || 0),
        away: parseFloat(game.actual_away_xg || game.away_xg_live || 0)
      };
      match.odds = { home: game.odds_home, draw: game.odds_draw, away: game.odds_away };

      if (game.lineups) { match.lineups = game.lineups; match.markModified('lineups'); }
      if (game.unavailable_players) { match.unavailable = game.unavailable_players; match.markModified('unavailable'); }
      
      if (game.live_stats) {
        match.statistics = game.live_stats;
        match.possession = {
          home: parseInt(game.live_stats.home?.ball_possession) || 0,
          away: parseInt(game.live_stats.away?.ball_possession) || 0
        };
        match.markModified('statistics');
        match.markModified('possession');
      }

      if (game.incidents) {
        match.goalsDetail = game.incidents.map(i => ({
          type: i.type,
          name: i.player_name || 'Jogador',
          min: i.minute,
          side: i.is_home ? 'home' : 'away',
          description: i.goal_type || i.card_type || ''
        }));
        match.markModified('goalsDetail');
      }

      await match.save();

      // --- 🏆 FINALIZAÇÃO ---
      if (statusChanged && newStatus === 'finished') {
        recalculateAllPoints(match.leagueId || '1')
          .then(() => trySaveDailyPoints(game.event_date))
          .catch(e => console.error("❌ [Erro Pontos]:", e.message));
      }

    } catch (gameErr) {
      console.error(`❌ [Erro Jogo ${game.id}]:`, gameErr.message);
    }
  }
}

// 🚀 A CORREÇÃO DO ERRO: Exporta a função diretamente
module.exports = updateMatches;
