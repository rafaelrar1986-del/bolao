const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY;

async function updateMatches() {
  try {
    console.log('🔍 TESTANDO API BSD...');

    const response = await axios.get(
      'https://sports.bzzoiro.com/api/events/?date_from=2026-06-10&date_to=2026-07-31',
      {
        headers: {
          Authorization: `Token ${API_KEY}`
        }
      }
    );

    const games = response.data.results || [];

    console.log('==============================');
    console.log('TOTAL DE JOGOS:', games.length);
    console.log('==============================');

    games.slice(0, 5).forEach((g, i) => {
      console.log(`\nJOGO ${i + 1}`);
      console.log(JSON.stringify(g, null, 2));
    });

  } catch (err) {
    console.error('❌ ERRO:', err.message);
  }
}

module.exports = updateMatches;
