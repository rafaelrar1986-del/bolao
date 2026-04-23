const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
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
  'extra_time_first_half': 'prorrogacao',
  'extra_time_second_half': 'prorrogacao',
  penalties: 'penaltis',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled'
};

/**
 * Extrai marcadores de gols dos incidentes para o seu front
 */
function extractGoals(incidents) {
  if (!incidents) return [];
  return incidents
    .filter(i => i.type === 'goal')
    .map(g => ({
      name: g.player_name || g.player,
      min: g.minute,
      side: g.is_home ? 'home' : 'away'
    }));
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
    if (!robotSettings) return;

    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    // 1️⃣ --- BUSCA PARTIDAS AO VIVO (30s cache) ---
    // Nota: O Live não aceita filtro de liga na URL, filtramos no processGameList
    console.log(`📡 [Live] Checando tempo real...`);
    const liveRes = await axios.get(`https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza`, {
      headers: { Authorization: `Token ${API_KEY}` }
    });
    await processGameList(liveRes.data.results, allowedLeagues, "LIVE");

    // 2️⃣ --- BUSCA RODADA COMPLETA (2min cache) ---
    // Usamos o filtro de ligas dinâmico aqui para otimizar a resposta
    const leaguesFilter = allowedLeagues.join(',');
    console.log(`🔍 [Events] Sincronizando ligas: ${leaguesFilter}`);
    
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza`;

    while (nextUrl) {
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });
      await processGameList(response.data.results, allowedLeagues, "EVENTS");
      nextUrl = response.data.next;
    }

    await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });

  } catch (err) {
    console.error('❌ [Erro Updater]:', err.message);
  }
}

async function processGameList(games, allowedLeagues, source) {
  if (!games) return;

  for (const game of games) {
    if (!allowedLeagues.includes(game.league?.id)) continue;

    const match = await Match.findOne({ apiId: game.id });
    if (!match) continue;

    const newStatus = statusMap[game.status] || 'scheduled';
    const newMinute = game.current_minute ? `${game.current_minute}'` : '';
    
    const newPenA = game.penalty_shootout?.home ?? null;
    const newPenB = game.penalty_shootout?.away ?? null;

    let autoQualifiedSide = match.qualifiedSide;
    const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
    
    if (isKnockout && newStatus === 'finished' && !match.qualifiedSide) {
       autoQualifiedSide = determineQualifier(game);
    }

    // --- COMPARAÇÃO DE MUDANÇAS ---
    const scoreChanged = match.scoreA !== game.home_score || match.scoreB !== game.away_score;
    const statusChanged = match.status !== newStatus;
    const minuteChanged = match.minute !== newMinute;
    const penaltiesChanged = match.penaltiesA !== newPenA || match.penaltiesB !== newPenB;
    const qualificationChanged = match.qualifiedSide !== autoQualifiedSide;

    const changed = scoreChanged || statusChanged || minuteChanged || penaltiesChanged || qualificationChanged;

    if (!changed) continue;

    const oldStatus = match.status;
    const oldMinute = match.minute;
    
    // Atualização do banco
    match.scoreA = game.home_score;
    match.scoreB = game.away_score;
    match.status = newStatus;
    match.minute = newMinute; 
    match.penaltiesA = newPenA;
    match.penaltiesB = newPenB;
    match.qualifiedSide = autoQualifiedSide;
    match.goalsDetail = extractGoals(game.incidents);

    await match.save();

    // --- LOGS DE MONITORAMENTO ---
    if (scoreChanged) {
      console.log(`⚽ GOL [${source}]: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB}`);
    } else if (newStatus === 'penaltis') {
      console.log(`🎯 PÊNALTIS: ${match.teamA} (${newPenA})x(${newPenB}) ${match.teamB}`);
    } else if (minuteChanged && !scoreChanged && !statusChanged) {
      // Log específico para mudança de tempo
      console.log(`⏱️ MINUTO [${source}]: ${match.teamA} vs ${match.teamB} (${newMinute})`);
    }

    // --- GATILHO DE RECALCULO ---
    if (oldStatus !== 'finished' && newStatus === 'finished') {
      const targetLeagueId = match.leagueId || '1';
      console.log(`🥇 [Sistema] Finalizado em ${source}. Recalculando Liga ${targetLeagueId}...`);
      try {
        await recalculateAllPoints(targetLeagueId); 
        await trySaveDailyPoints(game.event_date);
      } catch (err) {
        console.error(`❌ Erro Recálculo:`, err.message);
      }
    }
  }
}

module.exports = updateMatches;
