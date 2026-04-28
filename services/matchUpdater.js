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

// --- FUNÇÕES AUXILIARES DE EXTRAÇÃO ---

function extractIncidents(incidents) {
  if (!incidents || !Array.isArray(incidents)) return [];
  try {
    return incidents.map(i => ({
      type: i.type, // goal, card, subst
      name: i.player_name || i.player || 'Jogador',
      min: i.minute,
      extra: i.extra_minute || null,
      side: i.is_home ? 'home' : 'away',
      description: i.subtype_name || i.subtype || i.card_color || '', 
      playerIn: i.player_in_name || null,
      playerOut: i.player_out_name || null
    }));
  } catch (err) {
    console.error(`❌ [extractIncidents]:`, err.message);
    return [];
  }
}

function extractStats(game) {
  const result = { possession: { home: 0, away: 0 }, detailed: [] };
  // spatial=true geralmente retorna em 'statistics'
  const rawStats = game.statistics || game.stats;
  
  if (!rawStats || !Array.isArray(rawStats)) return result;

  result.detailed = rawStats;
  
  const poss = rawStats.find(s => 
    (s.type && s.type.toLowerCase().includes('possession')) || 
    (s.name && s.name.toLowerCase().includes('possession'))
  );

  if (poss) {
    result.possession.home = parseInt(poss.home || poss.home_value) || 0;
    result.possession.away = parseInt(poss.away || poss.away_value) || 0;
  }
  return result;
}

function determineQualifier(game) {
  const h = game.home_score ?? 0;
  const a = game.away_score ?? 0;
  if (h > a) return 'A';
  if (a > h) return 'B';
  
  const penHome = game.penalty_shootout?.home || 0;
  const penAway = game.penalty_shootout?.away || 0;
  if (penHome > penAway) return 'A';
  if (penAway > penHome) return 'B';
  return null;
}

// --- CORE DO UPDATER ---

async function updateMatches() {
  try {
    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) {
      console.error('❌ [Critical]: Settings "league_1" não encontrada.');
      return;
    }

    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];
    const headers = { Authorization: `Token ${API_KEY}` };

    // 1️⃣ BUSCA LIVE
    try {
      const liveRes = await axios.get(`https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza&spatial=true`, {
        headers, timeout: 10000
      });
      await processGameList(liveRes.data.results, allowedLeagues, "LIVE", robotSettings);
    } catch (e) {
      console.error(`❌ [Erro API LIVE]: ${e.message}`);
    }

    // 2️⃣ BUSCA EVENTS (Yesterday/Today/Tomorrow)
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza&spatial=true`;

    while (nextUrl) {
      try {
        const response = await axios.get(nextUrl, { headers, timeout: 15000 });
        await processGameList(response.data.results, allowedLeagues, "EVENTS", robotSettings);
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

async function processGameList(games, allowedLeagues, source, robotSettings) {
  if (!games || !Array.isArray(games)) return;

  for (const game of games) {
    try {
      if (!allowedLeagues.includes(game.league?.id)) continue;

      const match = await Match.findOne({ apiId: game.id });
      if (!match) continue;

      const newStatus = statusMap[game.status] || 'scheduled';
      const newMinute = game.current_minute ? `${game.current_minute}'` : '';
      
      // --- LÓGICA DE AUDITORIA (TRAVA DE GRADE) ---
      if (match.status === 'scheduled' && !['scheduled', 'cancelled', 'postponed'].includes(newStatus)) {
        const configId = `league_${match.leagueId || 1}`;
        const lockIdentifier = match.phaseName || match.group;
        const isAlreadyLocked = robotSettings.lockedPhases?.includes(lockIdentifier);

        if (!isAlreadyLocked) {
          console.log(`🛡️ [Bloqueio]: Trancando ${lockIdentifier}`);
          await Settings.findByIdAndUpdate(configId, {
            $addToSet: { 
              lockedPhases: lockIdentifier,
              unlockedPhases: { $each: [lockIdentifier, 'podium'] } 
            },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true } 
          });

          // Auditoria Assíncrona para não travar o loop
          auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier).then(async (csvFile) => {
            if (csvFile) {
              const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
              const emails = users.map(u => u.email).filter(e => !!e);
              if (emails.length > 0) {
                await emailService.sendBroadcastEmail(emails, `🔒 Auditoria: Grade ${lockIdentifier} Trancada`, "Palpites trancados.", csvFile);
              }
            }
          }).catch(e => console.error("Audit error:", e.message));

          robotSettings.lockedPhases.push(lockIdentifier);
        }
      }

      // --- ATUALIZAÇÃO DE DADOS ---
      const currentIncidents = extractIncidents(game.incidents);
      const isLive = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', '1_tet', '2_tet', 'penaltis'].includes(newStatus);
      const scoreChanged = match.scoreA !== game.home_score || match.scoreB !== game.away_score;
      const statusChanged = match.status !== newStatus;
      const incidentsChanged = JSON.stringify(match.goalsDetail) !== JSON.stringify(currentIncidents);
      
      if (scoreChanged || statusChanged || incidentsChanged || isLive || newStatus === 'finished') {
        const oldStatus = match.status;
        
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.minute = newMinute; 
        match.penaltiesA = game.penalty_shootout?.home ?? null;
        match.penaltiesB = game.penalty_shootout?.away ?? null;
        match.apiStatus = game.status_short || 'NS';

        // Atualiza Objetos Complexos
        match.goalsDetail = currentIncidents;
        const statsData = extractStats(game);
        match.possession = statsData.possession;
        match.statistics = statsData.detailed;

        if (game.lineups) {
          match.lineups = {
            home: game.lineups.home || {},
            away: game.lineups.away || {}
          };
        }

        // Forçar Mongoose a detectar mudanças para o ChangeStream (SSE)
        match.markModified('goalsDetail');
        match.markModified('statistics');
        match.markModified('lineups');
        match.markModified('possession');

        // Qualificação automática para Mata-mata
        if ((match.phase === 'knockout' || match.phase === 'mata-mata') && 
             newStatus === 'finished' && !match.qualifiedSide) {
          match.qualifiedSide = determineQualifier(game);
        }

        await match.save();

        if (scoreChanged) console.log(`⚽ GOL: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB}`);

        // --- FINALIZAÇÃO E PONTOS ---
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          console.log(`🏁 Finalizado: ${match.teamA} x ${match.teamB}`);
          const targetLeagueId = match.leagueId || '1';
          recalculateAllPoints(targetLeagueId)
            .then(() => trySaveDailyPoints(game.event_date))
            .catch(err => console.error(`❌ [Erro Pontos]:`, err.message));
        }
      }
    } catch (gameErr) {
      console.error(`❌ [Erro Jogo ${game.id}]:`, gameErr.message);
    }
  }
}

module.exports = updateMatches;
