const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🔧 normalização (remove acento, etc)
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, 'c')
    .trim();
}

// 🔁 status da API → seu padrão
function mapStatus(status) {
  if (!status) return 'Agendado';

  status = status.toLowerCase();

  if (status.includes('finished')) return 'Finalizado';
  if (status.includes('inprogress') || status.includes('live') || status.includes('half')) return 'Em andamento';

  return 'Agendado';
}

async function updateMatches() {
  try {
    console.log('🔄 Atualizando jogos (BSD API)...');

    const response = await axios.get(
      'https://sports.bzzoiro.com/api/events/?date_from=2026-06-01&date_to=2026-07-31',
      {
        headers: {
          Authorization: `Token ${API_KEY}`
        }
      }
    );

    const games = response.data.results || [];

    console.log(`📊 Jogos recebidos: ${games.length}`);

    const matches = await Match.find({});

    let updated = 0;

    for (const game of games) {
      const home = normalize(game.home_team);
      const away = normalize(game.away_team);

      const match = matches.find(m => {
        const teamA = normalize(m.teamA);
        const teamB = normalize(m.teamB);

        return (
          (teamA === home && teamB === away) ||
          (teamA === away && teamB === home)
        );
      });

      if (!match) continue;

      // evita sobrescrever jogo já finalizado
      if (match.status === 'Finalizado') continue;

      await Match.updateOne(
        { _id: match._id },
        {
          $set: {
            scoreA: game.home_score ?? null,
            scoreB: game.away_score ?? null,
            status: mapStatus(game.status)
          }
        }
      );

      console.log(`✅ ${match.teamA} x ${match.teamB}`);
      updated++;
    }

    console.log('='.repeat(50));
    console.log(`🎯 Jogos atualizados: ${updated}`);
    console.log('='.repeat(50));

  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

module.exports = updateMatches;
