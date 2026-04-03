const axios = require('axios');
const API_KEY = process.env.API_FOOTBALL_KEY;

async function debugFullApi() {
  try {
    console.log('--- INICIO DO DUMP COMPLETO (TODAS AS PAGINAS) ---');
    
    // URL inicial da Liga 27 (World Cup 2026)
    let url = 'https://sports.bzzoiro.com/api/events/?league=27&date_from=2026-06-01&date_to=2026-07-30';
    let page = 1;

    while (url) {
      console.log(`--- LENDO PÁGINA ${page} ---`);
      const response = await axios.get(url, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];
      
      games.forEach(g => {
        console.log(`P${page} | "${g.home_team}" x "${g.away_team}" | DATA: "${g.event_date}" | ID: ${g.id}`);
      });

      // Pega a próxima página
      url = response.data.next;
      page++;
    }
    
    console.log('--- FIM DO DUMP COMPLETO ---');
  } catch (err) {
    console.error('Erro ao baixar dados:', err.message);
  }
}

debugFullApi();
