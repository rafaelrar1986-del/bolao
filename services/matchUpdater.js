const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

const statusMap = {
  NS: 'Agendado',
  '1H': 'Em andamento',
  '2H': 'Em andamento',
  HT: 'Em andamento',
  ET: 'Em andamento',
  LIVE: 'Em andamento',
  FT: 'Finalizado',
  AET: 'Finalizado',
  PEN: 'Finalizado'
};

async function updateMatches() {
  try {
    console.log('🔄 Atualizando jogos...');

    const response = await axios.get(
      'https://v3.football.api-sports.io/fixtures?date=2026-06-13',
      {
        headers: {
          'x-apisports-key': API_KEY
        }
      }
    );

    const fixtures = response.data.response;

    for (const game of fixtures) {
      const match = await Match.findOne({ apiId: game.fixture.id });

      if (!match) continue;
      if (match.status === 'Finalizado') continue;

      await Match.updateOne(
        { _id: match._id },
        {
          $set: {
            scoreA: game.goals.home,
            scoreB: game.goals.away,
            status: statusMap[game.fixture.status.short] || 'Agendado'
          }
        }
      );
    }

    console.log('✅ Atualização concluída');
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

module.exports = updateMatches;
