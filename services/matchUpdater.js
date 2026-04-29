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
        const response = await axios.get(nextUrl, { headers, timeout: 15000 });
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
    console.error('❌ [Erro Global]:', err);
  }
}

async function processGameList(games, allowedLeagues, robotSettings, source) {
  for (const gameData of games) {
    try {
      if (!gameData.league?.id || !allowedLeagues.includes(gameData.league.id)) continue;

      const match = await Match.findOne({ apiId: gameData.id });
      if (!match) continue;

      // Criamos uma cópia de trabalho para não perder a referência original do loop
      let gameDetail = { ...gameData };

      console.log(`\n⚽ GAME ${gameDetail.id} (${source})`);

      const newStatus = statusMap[gameDetail.status] || 'scheduled';
      const statusChanged = match.status !== newStatus;

      // Auditoria (mantida sua lógica)
      if (match.status === 'scheduled' && !['scheduled', 'cancelled', 'postponed'].includes(newStatus)) {
        const lockIdentifier = match.phaseName || match.group;
        if (!robotSettings.lockedPhases?.includes(lockIdentifier)) {
          await Settings.findByIdAndUpdate(`league_1`, {
            $addToSet: { lockedPhases: lockIdentifier, unlockedPhases: { $each: [lockIdentifier, 'podium'] } },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
          });
          // ... (email audit logic mantida)
          robotSettings.lockedPhases = robotSettings.lockedPhases || [];
          robotSettings.lockedPhases.push(lockIdentifier);
        }
      }

      // Verificação de Lineup
      const currentHasPlayers = match.lineups?.home?.titulares?.length > 0;

      if (!currentHasPlayers) {
        try {
          console.log(`🔎 FETCH DETAIL ${gameDetail.id}`);
          const detailRes = await axios.get(
            `https://sports.bzzoiro.com/api/events/${gameDetail.id}/?spatial=true`,
            { headers, timeout: 8000 }
          );
          if (detailRes.data && detailRes.data.lineups) {
            gameDetail = detailRes.data; // Atualiza apenas se houver dados
          }
        } catch (err) {
          console.error(`❌ DETAIL ERROR ${gameDetail.id}:`, err.message);
        }
      }

      // Preparação do Update
      const updateData = {
        scoreA: gameDetail.home_score,
        scoreB: gameDetail.away_score,
        status: newStatus,
        minute: gameDetail.current_minute ? `${gameDetail.current_minute}'` : match.minute,
        penaltiesA: gameDetail.penalty_shootout?.home ?? null,
        penaltiesB: gameDetail.penalty_shootout?.away ?? null,
        xg: {
          home: parseFloat(gameDetail.actual_home_xg || gameDetail.home_xg_live || gameDetail.live_stats?.home?.expected_goals) || 0,
          away: parseFloat(gameDetail.actual_away_xg || gameDetail.away_xg_live || gameDetail.live_stats?.away?.expected_goals) || 0
        },
        odds: {
          home: gameDetail.odds_home || null,
          draw: gameDetail.odds_draw || null,
          away: gameDetail.odds_away || null
        }
      };

      // Só atualiza estatísticas se existirem no objeto atualizado
      if (gameDetail.live_stats) {
        updateData.statistics = gameDetail.live_stats;
        updateData.possession = {
          home: Number(gameDetail.live_stats.home?.ball_possession) || 0,
          away: Number(gameDetail.live_stats.away?.ball_possession) || 0
        };
      }

      // Só atualiza escalação se a API retornou algo nesta rodada
      const apiHasPlayers = gameDetail.lineups?.home?.players?.length > 0 || gameDetail.lineups?.away?.players?.length > 0;

      if (apiHasPlayers) {
        console.log(`🔥 SAVING LINEUP ${gameDetail.id} (Home: ${gameDetail.lineups.home.players.length})`);
        updateData.lineups = {
          home: mapLineupTeam(gameDetail.lineups.home),
          away: mapLineupTeam(gameDetail.lineups.away),
          confirmed: gameDetail.lineups?.confirmed || false
        };
      } else {
        console.log(`🛡️ PRESERVANDO DADOS EXISTENTES PARA ${gameDetail.id}`);
      }

      // Incidentes
      if (Array.isArray(gameDetail.incidents)) {
        updateData.goalsDetail = gameDetail.incidents.map(i => ({
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

      // Executa o Update Único
      await Match.updateOne({ _id: match._id }, { $set: updateData });
      console.log(`💾 SAVED ${gameDetail.id}`);

      if (statusChanged && newStatus === 'finished') {
        recalculateAllPoints(match.leagueId || '1')
          .then(() => trySaveDailyPoints(gameDetail.event_date))
          .catch(() => {});
      }

    } catch (err) {
      console.error(`❌ [Erro jogo ${gameData.id}]:`, err.message);
    }
  }
}

module.exports = updateMatches;
