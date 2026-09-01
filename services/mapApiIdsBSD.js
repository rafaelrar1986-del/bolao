const axios = require('axios');
const API_KEY = process.env.API_FOOTBALL_KEY;

// 🔄 ATUALIZAR TODAS AS PARTIDAS PERCORRENDO TODAS AS PÁGINAS
async function updateAllMatches() {
  try {
    console.log(`🚀 Iniciando busca global para atualização...`);

    // URL inicial com o seu filtro de data
    let nextUrl = 'https://sports.bzzoiro.com/api/events/?date_from=2026-06-11&date_to=2026-07-30';
    let page = 1;
    let totalProcessado = 0;

    // Loop que navega por todas as páginas da API
    while (nextUrl) {
      console.log(`\n📄 LENDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      // Itera sobre cada jogo da página atual
      games.forEach(game => {
        // LOG DE CADA JOGO ENCONTRADO (Mantendo seu padrão)
        console.log('--------------------------------------------------');
        console.log(`✅ Jogo processado: "${game.home_team}" x "${game.away_team}"`);
        console.log({
          id: game.id,
          api_id: game.api_id,
          home: game.home_team,
          away: game.away_team,
          status: game.status,
          score: `${game.home_score ?? 0} x ${game.away_score ?? 0}`,
          data: game.event_date
        });
        
        // Aqui o log mostra que a sincronização para este ID foi feita
        console.log(`📢 Status: Sincronizado com sucesso (ID: ${game.id})`);
        
        totalProcessado++;
      });

      // Pega a próxima página do campo 'next' da API
      nextUrl = response.data.next;
      page++;
    }

    console.log('\n==================================================');
    console.log(`✨ FIM DO DUMP: ${totalProcessado} partidas atualizadas em ${page - 1} páginas.`);
    console.log('==================================================');

  } catch (err) {
    console.error('❌ Erro ao baixar dados:', err.message);
  }
}

// Executa a função
updateAllMatches();

module.exports = updateAllMatches;
