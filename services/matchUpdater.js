const axios = require('axios');
const Match = require('../models/Match'); 

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

async function updateMatches() {
  try {
    console.log('🚀 [Cron] Iniciando busca global e atualização automática...');

    let nextUrl = 'https://sports.bzzoiro.com/api/events/?date_from=2026-04-05&date_to=2026-04-05';
    let updatedCount = 0;
    let page = 1;

    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        if (game.league?.id !== 6) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';

        // --- LÓGICA DE DETECÇÃO DE MUDANÇA ---
        // Agora o 'changed' verifica se o minuto da API é diferente do minuto atual no banco
        const changed =
          match.status !== newStatus ||
          match.scoreA !== game.home_score ||
          match.scoreB !== game.away_score ||
          match.minute !== newMinute; 

        if (!changed) continue;

        // --- LOGS DE ATUALIZAÇÃO ---
        const isOnlyMinuteUpdate = match.status === newStatus && 
                                   match.scoreA === game.home_score && 
                                   match.scoreB === game.away_score;

        if (isOnlyMinuteUpdate) {
          console.log(`⏳ [Minuto] ${match.teamA} x ${match.teamB}: ${match.minute || '0'} ➔ ${newMinute}`);
        } else {
          console.log('='.repeat(50));
          console.log(`⚽ PLACAR/STATUS: ${match.teamA} x ${match.teamB}`);
          console.log(`STATUS: ${match.status} ➔ ${newStatus}`);
          console.log(`PLACAR: ${match.scoreA}x${match.scoreB} ➔ ${game.home_score}x${game.away_score}`);
          console.log(`TEMPO: ${newMinute}`);
        }

        // --- SALVAMENTO ---
        // Atualizamos os campos no objeto encontrado
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.apiStatus = game.status;
        match.minute = newMinute;
        match.penaltiesA = game.home_penalty_score ?? null;
        match.penaltiesB = game.away_penalty_score ?? null;

        // O .save() persiste todas as alterações, incluindo o minuto
        await match.save();

        // Lógica de finalização de pontos (inalterada)
        if (match.status !== 'finished' && newStatus === 'finished') {
          console.log(`🏆 [Sistema] Partida Finalizada! Processando pontos...`);
          try {
            const result = await recalculateAllPoints();
            console.log(`✅ [Pontos] Sincronizados para ${result.updated} usuários.`);
            await trySaveDailyPoints(game.event_date);
          } catch (procError) {
            console.error(`❌ [Erro Processamento]:`, procError.message);
          }
        }
        updatedCount++;
      }
      nextUrl = response.data.next; 
      page++;
    }
    console.log('\n' + '='.repeat(50));
    console.log(`✨ [Fim da Rodada] Atualizações realizadas: ${updatedCount}`);
    console.log('='.repeat(50));
  } catch (err) {
    console.error('❌ [Erro Crítico]:', err.message);
  }
}

module.exports = updateMatches;
