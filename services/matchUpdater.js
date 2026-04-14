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
    // 1. Busca TODAS as configurações de ligas (Copa, Champions, etc)
    const allSettings = await Settings.find({});

    if (!allSettings || allSettings.length === 0) {
      console.log('⚠️ Nenhuma configuração de liga encontrada no banco.');
      return;
    }

    const now = Date.now();
    console.log(`🚀 [Cron] Iniciando atualização de ${allSettings.length} ligas...`);

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // Endpoint da API externa
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}`;
    let page = 1;

    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // 2. Identifica qual configuração de liga corresponde a este jogo da API
        const currentLeagueConfig = allSettings.find(s => s.api_leagues.includes(game.league?.id));
        
        if (!currentLeagueConfig) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        const apiHomeId = game.home_team_obj?.api_id;
        const apiAwayId = game.away_team_obj?.api_id;
        const newLogoA = apiHomeId ? `https://sports.bzzoiro.com/img/team/${apiHomeId}/?token=${API_KEY}` : '';
        const newLogoB = apiAwayId ? `https://sports.bzzoiro.com/img/team/${apiAwayId}/?token=${API_KEY}` : '';

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
        
        // Atualiza os dados no banco local
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

        // Logs de acompanhamento
        if (match.scoreA !== game.home_score || match.scoreB !== game.away_score) {
            console.log(`⚽ GOL: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB}`);
        } else if (oldMinute !== newMinute) {
            console.log(`⏱️ MINUTO: ${match.teamA} vs ${match.teamB} em ${newMinute}`);
        }

        // Se o jogo acabou, recalcula pontos e salva histórico
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          console.log(`🥇 Partida encerrada. Recalculando pontos para a liga ${currentLeagueConfig._id}...`);
          try {
            // Passamos o leagueId para o recálculo (ajuste seu pointsService se necessário)
            const result = await recalculateAllPoints(); 
            console.log(`✅ ${result.updated} usuários recalculados.`);
            await trySaveDailyPoints(game.event_date);
          } catch (procError) {
            console.error(`❌ Erro no recálculo:`, procError.message);
          }
        }
      }

      nextUrl = response.data.next; 
      page++;
    }

    // Atualiza o timestamp de execução em todas as ligas processadas
    await Settings.updateMany({}, { $set: { last_api_run: now } });

    console.log(`✨ Sincronização finalizada.`);

  } catch (err) {
    console.error('❌ [Erro Crítico no Updater]:', err.message);
  }
}

module.exports = updateMatches;
