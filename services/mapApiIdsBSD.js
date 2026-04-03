const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🔧 NORMALIZAÇÃO FORTE
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, 'c')
    .replace(/[^a-z\s]/g, '') // remove tudo estranho
    .replace(/\s+/g, ' ')
    .trim();
}

// 🔥 MATCH FLEXÍVEL (ESSENCIAL)
function isMatch(teamA, teamB, home, away) {
  const a = normalize(teamA);
  const b = normalize(teamB);
  const h = normalize(home);
  const aw = normalize(away);

  return (
    (a.includes(h) && b.includes(aw)) ||
    (a.includes(aw) && b.includes(h))
  );
}

async function mapApiIds() {
  try {
    console.log('🔍 Mapeando apiIds...');

    const response = await axios.get(
      'https://sports.bzzoiro.com/api/events/?date_from=2026-06-01&date_to=2026-07-30',
      {
        headers: {
          Authorization: `Token ${API_KEY}`
        }
      }
    );

    const games = response.data.results || [];
    const matches = await Match.find({});

    console.log('👉 Jogos no banco:', matches.length);
    console.log('👉 Jogos da API:', games.length);

    let mapped = 0;

    for (const game of games) {

      // ✅ só copa
      if (!game.league?.name?.includes('World Cup')) continue;

      // ❌ ignora play-off
      if (
        game.home_team.includes('Play-Off') ||
        game.away_team.includes('Play-Off')
      ) continue;

      const match = matches.find(m =>
        isMatch(m.teamA, m.teamB, game.home_team, game.away_team)
      );

      if (!match) {
        console.log(`❌ Não encontrou: ${game.home_team} x ${game.away_team}`);
        continue;
      }

      const result = await Match.updateOne(
        { _id: match._id },
        { $set: { apiId: game.api_id } }
      );

      console.log(
        `✅ ${match.teamA} x ${match.teamB} → ${game.api_id}`,
        '| modified:',
        result.modifiedCount
      );

      mapped++;
    }

    console.log('='.repeat(50));
    console.log(`🎯 Total mapeado: ${mapped}`);
    console.log('='.repeat(50));

  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

module.exports = mapApiIds;
