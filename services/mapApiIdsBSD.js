const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🔥 TRADUÇÃO EN → PT
const teamMap = {
  "brazil": "brasil",
  "morocco": "marrocos",
  "mexico": "mexico",
  "south africa": "africa do sul",
  "south korea": "coreia do sul",
  "usa": "estados unidos",
  "paraguay": "paraguai",
  "canada": "canada",
  "uzbekistan": "uzbequistao",
  "austria": "austria",
  "tunisia": "tunisia",
  "croatia": "croacia",
  "belgium": "belgica",
  "norway": "noruega",
  "sweden": "suecia",
  "germany": "alemanha",
  "spain": "espanha",
  "france": "franca",
  "england": "inglaterra",
  "argentina": "argentina",
  "uruguay": "uruguai",
  "colombia": "colombia",
  "ecuador": "equador",
  "ghana": "gana",
  "egypt": "egito",
  "senegal": "senegal",
  "algeria": "argelia",
  "turkey": "turquia",
  "italy": "italia",
  "netherlands": "holanda",
  "switzerland": "suica",
  "japan": "japao",
  "iran": "ira",
  "iraq": "iraque",
  "saudi arabia": "arabia saudita",
  "czech republic": "republica tcheca",
  "new zealand": "nova zelandia",
  "cape verde": "cabo verde",
  "ivory coast": "costa do marfim",
  "cote divoire": "costa do marfim",
  "cote d ivoire": "costa do marfim",
  "dr congo": "rd congo",
  "congo": "congo",
  "qatar": "catar",
  "scotland": "escocia",
  "jordan": "jordania"
};

// 🔧 NORMALIZAÇÃO
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, 'c')
    .replace(/'/g, '')
    .trim();
}

// 🔁 TRADUÇÃO + NORMALIZAÇÃO
function translate(name) {
  const n = normalize(name);
  return normalize(teamMap[n] || n);
}

async function mapApiIds() {
  try {
    console.log('🔍 Mapeando apiIds...');

    const response = await axios.get(
      'https://sports.bzzoiro.com/api/events/?date_from=2026-06-01&date_to=2026-07-20',
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

      // ✅ FILTRA COPA DO MUNDO (CORRIGIDO)
      if (!game.league?.name?.includes('World Cup')) continue;

      // ❌ ignora play-off
      if (
        game.home_team.includes('Play-Off') ||
        game.away_team.includes('Play-Off')
      ) continue;

      const home = translate(game.home_team);
      const away = translate(game.away_team);

      const match = matches.find(m => {
        const teamA = normalize(m.teamA);
        const teamB = normalize(m.teamB);

        return (
          (teamA === home && teamB === away) ||
          (teamA === away && teamB === home)
        );
      });

      if (!match) {
        console.log(`❌ Não encontrou: ${game.home_team} x ${game.away_team}`);
        continue;
      }

      // 🔥 ATUALIZA NO MONGO
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
