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

// ======================
// 🔥 MAPPER
// ======================
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
  if (!team) return { formation: "", titulares: [], reservas: [] };

  return {
    formation: team.formation || "",
    titulares: sortByPosition((team.players || []).map(mapPlayer)),
    reservas: (team.substitutes || []).map(mapPlayer)
  };
}

// ======================
// MAIN
// ======================
async function updateMatches() {
  try {
    console.log('🚀 UPDATER START');

    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) return;

    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    // LIVE
    try {
      const liveRes = await axios.get(
        `https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza&spatial=true`,
        { headers, timeout: 10000 }
      );

      console.log(`📡 LIVE: ${liveRes.data?.results?.length || 0} jogos`);

      if (liveRes.data?.results) {
        await processGameList(liveRes.data.results, allowedLeagues, robotSettings, 'LIVE');
      }
    } catch (e) {
      console.error(`❌ [Erro API LIVE]: ${e.message}`);
    }

    // EVENTS
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza&spatial=true`;

    while (nextUrl) {
      try {
        console.log(`📡 EVENTS URL: ${nextUrl}`);

        const response = await axios.get(nextUrl, { headers, timeout: 15000 });

        console.log(`📡 EVENTS: ${response.data?.results?.length || 0} jogos`);

        if (response.data?.results) {
          await processGameList(response.data.results, allowedLeagues, robotSettings, 'EVENTS');
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

// ======================
// PROCESS GAMES
// ======================
async function processGameList(games, allowedLeagues, robotSettings, source) {
  if (!games || !Array.isArray(games)) return;

  for (let game of games) {
    try {
      if (!game.league?.id || !allowedLeagues.includes(game.league.id)) continue;

      const match = await Match.findOne({ apiId: game.id });
      if (!match) continue;

      console.log(`\n⚽ GAME ${game.id} (${source})`);

      const newStatus = statusMap[game.status] || 'scheduled';
      const statusChanged = match.status !== newStatus;

      // ======================
      // 🔒 AUDITORIA
      // ======================
      if (match.status === 'scheduled' && !['scheduled', 'cancelled', 'postponed'].includes(newStatus)) {
        const configId = `league_${match.leagueId || 1}`;
        const lockIdentifier = match.phaseName || match.group;

        if (!robotSettings.lockedPhases?.includes(lockIdentifier)) {
          await Settings.findByIdAndUpdate(configId, {
            $addToSet: { 
              lockedPhases: lockIdentifier,
              unlockedPhases: { $each: [lockIdentifier, 'podium'] }
            },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
          });

          auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier)
            .then(async (csvFile) => {
              if (!csvFile) return;

              const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
              const emails = users.map(u => u.email).filter(Boolean);

              if (emails.length > 0) {
                await emailService.sendBroadcastEmail(
                  emails,
                  `🔒 Auditoria: ${lockIdentifier}`,
                  "Segue auditoria.",
                  csvFile
                );
              }
            });

          robotSettings.lockedPhases = robotSettings.lockedPhases || [];
          robotSettings.lockedPhases.push(lockIdentifier);
        }
      }

      // ======================
      // DETAIL
      // ======================
      const currentHasPlayers =
        match.lineups?.home?.titulares?.length > 0 ||
        match.lineups?.away?.titulares?.length > 0;

      if (!currentHasPlayers) {
        try {
          console.log(`🔎 DETAIL ${game.id}`);

          const detailRes = await axios.get(
            `https://sports.bzzoiro.com/api/events/${game.id}/?spatial=true`,
            { headers, timeout: 8000 }
          );

          if (detailRes.data) {
            game = detailRes.data;

            console.log(`👥 HOME players: ${game.lineups?.home?.players?.length || 0}`);
            console.log(`👥 AWAY players: ${game.lineups?.away?.players?.length || 0}`);
          }

        } catch (err) {
          console.error(`❌ DETAIL ERROR ${game.id}:`, err.message);
        }
      } else {
        console.log(`⏭️ SKIP DETAIL (já tem lineup) ${game.id}`);
      }

      // SCORE
      match.scoreA = game.home_score;
      match.scoreB = game.away_score;
      match.status = newStatus;
      match.minute = game.current_minute ? `${game.current_minute}'` : match.minute || '';
      match.penaltiesA = game.penalty_shootout?.home ?? null;
      match.penaltiesB = game.penalty_shootout?.away ?? null;

      // xG
      match.xg = {
        home: parseFloat(game.actual_home_xg || game.home_xg_live || game.live_stats?.home?.expected_goals) || 0,
        away: parseFloat(game.actual_away_xg || game.away_xg_live || game.live_stats?.away?.expected_goals) || 0
      };

      // ODDS
      match.odds = {
        home: game.odds_home || null,
        draw: game.odds_draw || null,
        away: game.odds_away || null
      };

      // ======================
      // LINEUP FIX
      // ======================
      const hasPlayers =
        game.lineups?.home?.players?.length > 0 ||
        game.lineups?.away?.players?.length > 0;

      if (hasPlayers) {
        console.log(`🔥 SAVING LINEUP ${game.id}`);

        match.lineups = {
          home: mapLineupTeam(game.lineups.home),
          away: mapLineupTeam(game.lineups.away),
          confirmed: game.lineups?.confirmed || false
        };
      } else if (currentHasPlayers) {
        console.log(`🛡️ MANTENDO LINEUP EXISTENTE ${game.id}`);
      } else {
        console.log(`⚠️ SEM PLAYERS E SEM LINEUP ${game.id}`);
      }

      // STATS
      if (game.live_stats) {
        match.statistics = game.live_stats;
        match.possession = {
          home: Number(game.live_stats.home?.ball_possession) || 0,
          away: Number(game.live_stats.away?.ball_possession) || 0
        };
      }

      // INCIDENTES
      if (Array.isArray(game.incidents)) {
        match.goalsDetail = game.incidents.map(i => ({
          type: i.type,
          name: i.player_name || i.player || 'Jogador',
          min: i.minute,
          extra: i.extra_minute || null,
          side: i.is_home ? 'home' : 'away',
          description: i.goal_type || i.card_type || i.subtype || '',
          playerIn: i.player_in_name || null,
          playerOut: i.player_out_name || null
        }));
      }

      // SAVE
      await Match.updateOne(
        { _id: match._id },
        {
          $set: {
            scoreA: match.scoreA,
            scoreB: match.scoreB,
            status: match.status,
            minute: match.minute,
            penaltiesA: match.penaltiesA,
            penaltiesB: match.penaltiesB,
            xg: match.xg,
            odds: match.odds,
            statistics: match.statistics,
            possession: match.possession,
            goalsDetail: match.goalsDetail,
            ...(hasPlayers && { lineups: match.lineups })
          }
        }
      );

      console.log(`💾 SAVED ${game.id}`);

      if (statusChanged && newStatus === 'finished') {
        recalculateAllPoints(match.leagueId || '1')
          .then(() => trySaveDailyPoints(game.event_date))
          .catch(() => {});
      }

    } catch (err) {
      console.error(`❌ [Erro jogo ${game.id}]:`, err.message);
    }
  }
}

module.exports = updateMatches;
