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
    // 🔍 BUSCA CONFIGURAÇÃO NA LIGA 1 (Gaveta global do Robô)
    const robotSettings = await Settings.findById('league_1');

    if (!robotSettings) {
      console.log('⚠️ Configurações da Liga 1 não encontradas. Abortando Updater.');
      return;
    }

    const config = {
      leagues: robotSettings.api_leagues || [], // IDs das ligas da API (ex: [4, 6])
      season: robotSettings.api_season || 2026
    };

    if (config.leagues.length === 0) {
      console.log('⚠️ Nenhuma liga configurada no robô da Liga 1.');
      return;
    }

    const now = Date.now();
    console.log(`🚀 [Cron] Iniciando Updater (Monitorando ${config.leagues.length} ligas)...`);

    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}`;
    let updatedCount = 0;
    let page = 1;

    while (nextUrl) {
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // Verifica se esta liga do jogo está na lista permitida da Liga 1
        if (!config.leagues.includes(game.league?.id)) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        const apiHomeId = game.home_team_obj?.api_id;
        const apiAwayId = game.away_team_obj?.api_id;
        const newLogoA = apiHomeId ? `https://sports.bzzoiro.com/img/team/${apiHomeId}/?token=${API_KEY}` : match.logoA;
        const newLogoB = apiAwayId ? `https://sports.bzzoiro.com/img/team/${apiAwayId}/?token=${API_KEY}` : match.logoB;

        let autoQualifiedSide = match.qualifiedSide;
        const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
        
        if (isKnockout && newStatus === 'finished' && !match.qualifiedSide) {
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
        const oldMinute = match.minute;
        
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

        // Logs de monitoramento
        if (match.scoreA !== game.home_score || match.scoreB !== game.away_score) {
            console.log(`⚽ GOL na Liga ${match.leagueId}: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB}`);
        } else if (oldMinute !== newMinute) {
            console.log(`⏱️ MINUTO: ${match.teamA} vs ${match.teamB} (${newMinute})`);
        }

        // Se a partida terminou, recalcula pontos da liga correspondente
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          const targetLeagueId = match.leagueId || '1';
          console.log(`🥇 [Sistema] Partida encerrada na Liga ${targetLeagueId}. Recalculando...`);
          try {
            // Passa o targetLeagueId para o serviço de pontos saber qual liga processar
            await recalculateAllPoints(targetLeagueId); 
            await trySaveDailyPoints(game.event_date);
          } catch (procError) {
            console.error(`❌ [Erro Recálculo Liga ${targetLeagueId}]:`, procError.message);
          }
        }
        updatedCount++;
      }

      nextUrl = response.data.next; 
      page++;
    }

    // Atualiza o timestamp da última execução na Liga 1
    await Settings.findByIdAndUpdate('league_1', { 
      $set: { last_api_run: now } 
    });

    console.log(`✨ [Fim da Rodada] Sincronizados: ${updatedCount} jogos com alterações.`);

  } catch (err) {
    console.error('❌ [Erro Crítico no Updater]:', err.message);
  }
}

module.exports = updateMatches;
