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

function determineQualifier(game) {
  if (game.home_score > game.away_score) return 'A';
  if (game.away_score > game.home_score) return 'B';
  if (game.home_penalty_score > game.away_penalty_score) return 'A';
  if (game.away_penalty_score > game.home_penalty_score) return 'B';
  return null;
}

async function updateMatches() {
  try {
    // Busca todas as configurações de ligas ativas
    const allSettings = await Settings.find({});

    if (!allSettings || allSettings.length === 0) {
      console.log('⚠️ Nenhuma configuração de liga encontrada.');
      return;
    }

    const now = Date.now();
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}`;
    
    while (nextUrl) {
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // 1. Verifica se o jogo pertence a alguma liga configurada
        // O robô agora identifica qual a 'config' (e o leagueId) baseada no api_leagues
        const config = allSettings.find(s => s.api_leagues.includes(game.league?.id));
        if (!config) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        const apiHomeId = game.home_team_obj?.api_id;
        const apiAwayId = game.away_team_obj?.api_id;
        const newLogoA = apiHomeId ? `https://sports.bzzoiro.com/img/team/${apiHomeId}/?token=${API_KEY}` : '';
        const newLogoB = apiAwayId ? `https://sports.bzzoiro.com/img/team/${apiAwayId}/?token=${API_KEY}` : '';

        let autoQualifiedSide = match.qualifiedSide;
        if ((match.phase === 'knockout' || match.phase === 'mata-mata') && newStatus === 'finished' && !match.qualifiedSide) {
           autoQualifiedSide = determineQualifier(game);
        }

        const changed =
          match.status !== newStatus ||
          match.scoreA !== game.home_score ||
          match.scoreB !== game.away_score ||
          match.minute !== newMinute || 
          match.logoA !== newLogoA ||
          match.logoB !== newLogoB ||
          match.qualifiedSide !== autoQualifiedSide; 

        if (!changed) continue;

        const oldStatus = match.status;
        
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.apiStatus = game.status;
        match.minute = newMinute;
        match.logoA = newLogoA; 
        match.logoB = newLogoB; 
        match.penaltiesA = game.home_penalty_score ?? null;
        match.penaltiesB = game.away_penalty_score ?? null;
        match.qualifiedSide = autoQualifiedSide;

        await match.save();

        // 2. Recálculo condicional por LIGA
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          try {
            // CRÍTICO: Agora passamos o leagueId da configuração encontrada
            // match.leagueId geralmente é um Number, e config.leagueId também.
            const targetLeagueId = match.leagueId || config.leagueId;

            if (targetLeagueId) {
              console.log(`⚽ Partida finalizada. Recalculando pontos para liga: ${targetLeagueId}`);
              await recalculateAllPoints(targetLeagueId); 
              await trySaveDailyPoints(game.event_date);
            }
          } catch (procError) {
            console.error(`❌ Erro no recálculo para liga ${match.leagueId}:`, procError.message);
          }
        }
      }
      nextUrl = response.data.next; 
    }

    // Atualiza o timestamp de execução em todas as ligas processadas
    await Settings.updateMany({}, { $set: { last_api_run: now } });

  } catch (err) {
    console.error('❌ [Erro no Updater]:', err.message);
  }
}

module.exports = updateMatches;
