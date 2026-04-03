const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🔍 BUSCAR PARTIDA PELO api_id
async function getMatchByApiId(apiId) {
  try {
    console.log(`🔍 Buscando jogo com api_id: ${apiId}`);

    const response = await axios.get(
      'https://sports.bzzoiro.com/api/events/?date_from=2026-06-01&date_to=2026-07-30',
      {
        headers: {
          Authorization: `Token ${API_KEY}`
        }
      }
    );

    const games = response.data.results || [];

    const game = games.find(g => g.api_id === apiId);

    if (!game) {
      console.log('❌ Jogo não encontrado');
      return null;
    }

    console.log('✅ Jogo encontrado:\n');
    console.log({
      id: game.id,
      api_id: game.api_id,
      home: game.home_team,
      away: game.away_team,
      status: game.status,
      score: `${game.home_score} x ${game.away_score}`
    });

    return game;

  } catch (err) {
    console.error('❌ Erro:', err.message);
    return null;
  }
}

module.exports = getMatchByApiId;
