const axios = require('axios');
const API_KEY = process.env.API_FOOTBALL_KEY;

async function debugApiData() {
  try {
    console.log('--- INICIO DO DUMP DA API ---');
    // Pegando a primeira página da Copa
    const url = 'https://sports.bzzoiro.com/api/events/?league=27&date_from=2026-06-01&date_to=2026-07-30';
    const response = await axios.get(url, {
      headers: { Authorization: `Token ${API_KEY}` }
    });

    const games = response.data.results || [];
    
    games.forEach(g => {
      console.log(`TIME_HOME: "${g.home_team}" | TIME_AWAY: "${g.away_team}" | DATA_API: "${g.event_date}" | ID: ${g.id}`);
    });
    
    console.log('--- FIM DO DUMP ---');
  } catch (err) {
    console.error('Erro ao baixar dados:', err.message);
  }
}

debugApiData();
