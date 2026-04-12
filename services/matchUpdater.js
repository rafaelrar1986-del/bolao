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
    // 1. Busca as configurações definidas no seu Painel Administrativo
    const settings = await Settings.findById('global_settings');

    const config = {
      interval: settings?.cron_interval || 5,
      leagues: settings?.api_leagues || [4, 6, 32, 33],
      season: settings?.api_season || 2026,
      lastRun: settings?.last_api_run || 0
    };

    const now = Date.now();
    const diffMinutes = (now - config.lastRun) / (1000 * 60);

    // AJUSTE DE PRECISÃO: Folga de 0.25 (15 segundos) para garantir o ciclo de 1 min
    if (diffMinutes < (config.interval - 0.25)) {
      return; 
    }

    console.log(`🚀 [Cron] Iniciando atualização automática... (Intervalo: ${config.interval}min)`);

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}`;
    let updatedCount = 0;
    let page = 1;

    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // Pula jogos de ligas que não estão configuradas no admin
        if (!config.leagues.includes(game.league?.id)) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        // Lógica de Imagens (BSD CDN)
        const apiHomeId = game.home_team_obj?.api_id;
        const apiAwayId = game.away_team_obj?.api_id;
        const newLogoA = apiHomeId ? `https://sports.bzzoiro.com/img/team/${apiHomeId}/?token=${API_KEY}` : '';
        const newLogoB = apiAwayId ? `https://sports.bzzoiro.com/img/team/${apiAwayId}/?token=${API_KEY}` : '';

        let autoQualifiedSide = match.qualifiedSide;
        const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
        
        if (isKnockout && newStatus === 'finished' && !match.qualifiedSide) {
           autoQualifiedSide = determineQualifier(game);
        }

        // Verifica se houve qualquer alteração relevante
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
        
        // Atualiza os dados no objeto da partida
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.apiStatus = game.status;
        match.minute = newMinute;
        match.logoA = newLogoA; // Agora salvando a logo oficial
        match.logoB = newLogoB; // Agora salvando a logo oficial
        match.penaltiesA = game.home_penalty_score ?? null;
        match.penaltiesB = game.away_penalty_score ?? null;
        match.qualifiedSide = autoQualifiedSide;

        await match.save();

        if (oldStatus !== newStatus || match.scoreA !== game.home_score || match.scoreB !== game.away_score) {
          console.log(`⚽ ATUALIZADO: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB} (${newStatus})`);
        }

        // Lógica de encerramento e pontos
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          console.log(`🥇 [Sistema] Partida encerrada. Recalculando pontos...`);
          try {
            const result = await recalculateAllPoints();
            console.log(`✅ [Sucesso] ${result.updated} usuários atualizados.`);
            await trySaveDailyPoints(game.event_date);
          } catch (procError) {
            console.error(`❌ [Erro Recálculo]:`, procError.message);
          }
        }
        updatedCount++;
      }

      nextUrl = response.data.next; 
      page++;
    }

    // Atualiza a timestamp da última execução para o controle de intervalo
    await Settings.findByIdAndUpdate('global_settings', { 
      $set: { last_api_run: now } 
    });

    console.log(`✨ [Fim da Rodada] Sincronizados: ${updatedCount} | Próxima em: ${config.interval}min`);

  } catch (err) {
    console.error('❌ [Erro Crítico no Updater]:', err.message);
  }
}

module.exports = updateMatches;
