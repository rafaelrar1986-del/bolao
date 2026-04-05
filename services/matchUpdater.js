const axios = require('axios');
// Assumindo que a pasta 'models' está no mesmo nível da pasta 'services'
const Match = require('../models/Match'); 

// Como estes arquivos estão na MESMA pasta que este (services/), usamos ./
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

        const changed =
          match.status !== newStatus ||
          match.scoreA !== game.home_score ||
          match.scoreB !== game.away_score;

        if (!changed) continue;

        console.log('='.repeat(50));
        console.log(`⚽ ATUALIZAÇÃO: ${match.teamA} x ${match.teamB}`);
        console.log(`STATUS: ${match.status} ➔ ${newStatus}`);
        console.log(`PLACAR: ${match.scoreA}x${match.scoreB} ➔ ${game.home_score}x${game.away_score}`);

        await Match.updateOne(
          { _id: match._id },
          {
            $set: {
              scoreA: game.home_score,
              scoreB: game.away_score,
              status: newStatus,
              apiStatus: game.status,
              minute: game.current_minute ? `${game.current_minute}'` : '',
              penaltiesA: game.home_penalty_score ?? null,
              penaltiesB: game.away_penalty_score ?? null
            }
          }
        );

        // Dispara o processamento apenas se o jogo finalizou agora
        if (match.status !== 'finished' && newStatus === 'finished') {
          console.log(`🏆 [Sistema] Partida Finalizada! Processando pontos e histórico...`);
          try {
            // 1. Recalcula pontos globais
            const result = await recalculateAllPoints();
            console.log(`✅ [Pontos] Sincronização concluída para ${result.updated} usuários.`);
            
            // 2. Tenta fechar o dia e salvar no histórico
            await trySaveDailyPoints(game.event_date);
          } catch (procError) {
            console.error(`❌ [Erro Processamento] Falha ao liquidar pontos/histórico:`, procError.message);
          }
        }
        updatedCount++;
      }
      nextUrl = response.data.next; 
      page++;
    }
    console.log('\n' + '='.repeat(50));
    console.log(`✨ [Fim da Rodada] Partidas atualizadas: ${updatedCount}`);
    console.log('='.repeat(50));
  } catch (err) {
    console.error('❌ [Erro Crítico]:', err.message);
  }
}

module.exports = updateMatches;
