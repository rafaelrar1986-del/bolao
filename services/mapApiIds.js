const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

async function mapApiIds() {
  try {
    console.log('🔍 Buscando jogos da API...');

    const response = await axios.get(
      'https://v3.football.api-sports.io/fixtures?from=2026-06-11&to=2026-06-27',
      {
        headers: {
          'x-apisports-key': API_KEY
        }
      }
    );

    const fixtures = response.data.response;
    const matches = await Match.find({});

    let mapped = 0;

    for (const match of matches) {
      if (match.apiId) continue;

      const date = match.date.split('/').reverse().join('-');

      const teamA = normalize(match.teamA);
      const teamB = normalize(match.teamB);

      const found = fixtures.find(f => {
        const apiDate = f.fixture.date.slice(0, 10);

        const home = normalize(f.teams.home.name);
        const away = normalize(f.teams.away.name);

        const sameTeams =
          (home === teamA && away === teamB) ||
          (home === teamB && away === teamA);

        return sameTeams && apiDate === date;
      });

      if (!found) {
        console.log(`❌ Não encontrou: ${match.teamA} x ${match.teamB}`);
        continue;
      }

      await Match.updateOne(
        { _id: match._id },
        {
          $set: { apiId: found.fixture.id }
        }
      );

      console.log(`✅ ${match.teamA} x ${match.teamB}`);
      mapped++;
    }

    console.log(`🎯 Total mapeado: ${mapped}`);
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

module.exports = mapApiIds;
