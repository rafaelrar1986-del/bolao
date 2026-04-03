const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🎯 MAPA DE STATUS (API BSD → SEU SISTEMA)
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
    console.log('🔄 Iniciando busca global e atualização de todas as páginas...');

    // URL inicial
    let nextUrl = 'https://sports.bzzoiro.com/api/events/?date_from=2026-06-11&date_to=2026-07-28';
    let updated = 0;
    let notFound = 0;
    let page = 1;

    // 🔄 LOOP DE PAGINAÇÃO
    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: {
          Authorization: `Token ${API_KEY}`
        }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // 🏆 Filtra só Copa (Liga 27)
        if (game.league?.id !== 27) continue;

        // Busca no seu banco pelo ID da API (8287, etc)
        const match = await Match.findOne({ apiId: game.id });

        // 🔍 LOG se não encontrar no banco
        if (!match) {
          console.log(`❌ NÃO ENCONTROU NO BANCO: ${game.home_team} x ${game.away_team} | ID: ${game.id}`);
          notFound++;
          continue;
        }

        const newStatus = statusMap[game.status] || 'scheduled';

        const before = {
          status: match.status,
          scoreA: match.scoreA,
          scoreB: match.scoreB
        };

        const after = {
          status: newStatus,
          scoreA: game.home_score,
          scoreB: game.away_score
        };

        // 🔥 Verifica mudança
        const changed =
          before.status !== after.status ||
          before.scoreA !== after.scoreA ||
          before.scoreB !== after.scoreB;

        if (!changed) continue;

        // 📋 LOG DETALHADO (Mantendo seu padrão)
        console.log('='.repeat(50));
        console.log(`⚽ ${match.teamA} x ${match.teamB}`);
        console.log(`API: ${game.home_team} x ${game.away_team}`);
        console.log(`ANTES: ${before.status} | ${before.scoreA} x ${before.scoreB}`);
        console.log(`DEPOIS: ${after.status} | ${after.scoreA} x ${after.scoreB}`);

        // 🏁 FINALIZADO
        if (after.status === 'finished') {
          console.log(`🏁 FINALIZADO: ${match.teamA} x ${match.teamB}`);
        }

        // 🔄 UPDATE NO MONGODB
        await Match.updateOne(
          { _id: match._id },
          {
            $set: {
              scoreA: after.scoreA,
              scoreB: after.scoreB,
              status: after.status,
              apiStatus: game.status,
              minute: game.current_minute
                ? `${game.current_minute}'`
                : '',
              penaltiesA: game.home_penalty_score ?? null,
              penaltiesB: game.away_penalty_score ?? null
            }
          }
        );

        updated++;
      }

      // ⏭️ ATUALIZA URL PARA A PRÓXIMA PÁGINA
      nextUrl = response.data.next; 
      page++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`🎯 FIM DO PROCESSO`);
    console.log(`✅ Total de Partidas Atualizadas: ${updated}`);
    console.log(`❌ Total de Partidas não encontradas: ${notFound}`);
    console.log('='.repeat(50));

  } catch (err) {
    console.error('❌ Erro ao atualizar partidas:', err.message);
  }
}

module.exports = updateMatches;
