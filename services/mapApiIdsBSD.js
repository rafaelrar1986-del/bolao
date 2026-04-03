const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🌎 DICIONÁRIO DE TRADUÇÃO E MAPEAMENTO DE PLAY-OFFS
// Chave: Nome como vem na API (Inglês/Genérico) -> Valor: Nome no seu Banco (Português)
const teamMap = {
  // 🏆 SEUS CLASSIFICADOS VIA PLAY-OFF (DE ACORDO COM SUA TABELA)
  "fifa play-off 1": "rd congo",
  "fifa play-off 2": "iraque",
  "uefa play-off a": "bosnia e herzegovina",
  "uefa play-off b": "suecia",
  "uefa play-off c": "turquia",

  // 🌍 ÁFRICA & ÁSIA
  "cote d'ivoire": "costa do marfim",
  "cote divoire": "costa do marfim",
  "ivory coast": "costa do marfim",
  "dr congo": "rd congo",
  "south africa": "africa do sul",
  "morocco": "marrocos",
  "egypt": "egito",
  "tunisia": "tunisia",
  "algeria": "argelia",
  "ghana": "gana",
  "senegal": "senegal",
  "south korea": "coreia do sul",
  "korea republic": "coreia do sul",
  "japan": "japao",
  "saudi arabia": "arabia saudita",
  "iran": "ira",
  "iraq": "iraque",
  "jordan": "jordania",
  "qatar": "catar",
  "uzbekistan": "uzbequistao",

  // 🌎 AMÉRICAS
  "brazil": "brasil",
  "mexico": "mexico",
  "usa": "estados unidos",
  "united states": "estados unidos",
  "canada": "canada",
  "argentina": "argentina",
  "uruguay": "uruguai",
  "colombia": "colombia",
  "ecuador": "equador",
  "paraguay": "paraguai",
  "chile": "chile",
  "peru": "peru",

  // 🇪🇺 EUROPA
  "germany": "alemanha",
  "france": "franca",
  "spain": "espanha",
  "england": "inglaterra",
  "italy": "italia",
  "netherlands": "holanda",
  "belgium": "belgica",
  "portugal": "portugal",
  "croatia": "croacia",
  "switzerland": "suica",
  "turkey": "turquia",
  "sweden": "suecia",
  "norway": "noruega",
  "bosnia and herzegovina": "bosnia e herzegovina",
  "czech republic": "republica tcheca",
  "austria": "austria",
  "poland": "polonia"
};

// 🔧 FUNÇÃO DE NORMALIZAÇÃO
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, '')    // Mantém números para os Play-offs
    .replace(/\s+/g, ' ')
    .trim();
}

// 🔁 TRADUÇÃO
function translate(name) {
  const n = normalize(name);
  return normalize(teamMap[n] || n);
}

// 🔥 MATCH INTELIGENTE (Cruza nomes traduzidos)
function isMatch(teamA, teamB, homeApi, awayApi) {
  const h = translate(homeApi);
  const aw = translate(awayApi);
  const a = normalize(teamA);
  const b = normalize(teamB);

  // Match exato ou invertido (ordem de mandante/visitante)
  return (a === h && b === aw) || (a === aw && b === h) ||
         (a.includes(h) && b.includes(aw)) || (a.includes(aw) && b.includes(h));
}

async function mapApiIds() {
  try {
    console.log('🔍 Iniciando mapeamento com Play-offs definidos...');

    const matchesInDb = await Match.find({});
    console.log(`👉 Jogos no Banco: ${matchesInDb.length}`);

    // URL com league=27 (World Cup) e range total da Copa
    let url = 'https://sports.bzzoiro.com/api/events/?league=27&date_from=2026-06-01&date_to=2026-07-30&tz=America/Fortaleza';
    let mapped = 0;

    while (url) {
      const response = await axios.get(url, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const apiGames = response.data.results || [];
      
      for (const game of apiGames) {
        // Busca o jogo no seu banco usando a lógica do dicionário
        const match = matchesInDb.find(m => 
          isMatch(m.teamA, m.teamB, game.home_team, game.away_team)
        );

        if (match) {
          const res = await Match.updateOne(
            { _id: match._id },
            { $set: { apiId: game.id, lastSync: new Date() } }
          );

          if (res.modifiedCount > 0) {
            console.log(`✅ MAPEADO: ${match.teamA} x ${match.teamB} → ID: ${game.id}`);
            mapped++;
          }
        } else {
          console.log(`❌ S/ MATCH: ${game.home_team} x ${game.away_team}`);
        }
      }

      // Avança para a próxima página da API
      url = response.data.next;
    }

    console.log('\n' + '='.repeat(40));
    console.log(`🎯 TOTAL MAPEADO: ${mapped}/${matchesInDb.length}`);
    console.log('='.repeat(40));

  } catch (err) {
    console.error('❌ ERRO CRÍTICO:', err.message);
  }
}

module.exports = mapApiIds;
