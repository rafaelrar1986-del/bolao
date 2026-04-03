const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🌎 DICIONÁRIO COMPLETO (API -> SEU BANCO)
const teamMap = {
  // Play-offs (Conforme sua definição)
  "fifa play-off 1": "rd congo",
  "fifa play-off 2": "iraque",
  "uefa play-off a": "bosnia e herzegovina",
  "uefa play-off b": "suecia",
  "uefa play-off c": "turquia",
  "uefa play-off d": "africa do sul",

  // Seleções e Variações
  "brazil": "brasil",
  "france": "franca",
  "spain": "espanha",
  "belgium": "belgica",
  "morocco": "marrocos",
  "south korea": "coreia do sul",
  "korea republic": "coreia do sul",
  "usa": "estados unidos",
  "united states": "estados unidos",
  "ivory coast": "costa do marfim",
  "cote d'ivoire": "costa do marfim",
  "cote divoire": "costa do marfim",
  "scotland": "escocia",
  "germany": "alemanha",
  "italy": "italia",
  "england": "inglaterra",
  "netherlands": "holanda",
  "switzerland": "suica",
  "croatia": "croacia",
  "japan": "japao",
  "iraq": "iraque",
  "iran": "ira",
  "saudi arabia": "arabia saudita",
  "qatar": "catar",
  "jordan": "jordania",
  "egypt": "egito",
  "tunisia": "tunisia",
  "algeria": "argelia",
  "ghana": "gana",
  "senegal": "senegal",
  "uruguay": "uruguai",
  "colombia": "colombia",
  "ecuador": "equador",
  "paraguay": "paraguai",
  "chile": "chile",
  "peru": "peru",
  "mexico": "mexico",
  "canada": "canada",
  "austria": "austria",
  "poland": "polonia",
  "portugal": "portugal",
  "uzbekistan": "uzbequistao",
  "new zealand": "nova zelandia",
  "panama": "panama"
};

// 🔧 NORMALIZAÇÃO
function normalize(str) {
  return (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ç/g, 'c').replace(/[^a-z0-9\s]/g, '').trim();
}

function translate(name) {
  const n = normalize(name);
  return normalize(teamMap[n] || n);
}

async function mapApiIds() {
  try {
    console.log('🚀 Iniciando Mapeamento Direto (String Match)...');

    const matchesInDb = await Match.find({});
    console.log(`👉 Jogos no Banco: ${matchesInDb.length}`);

    // URL sem timezone (usando o padrão que já bate com o seu 16:00)
    let url = 'https://sports.bzzoiro.com/api/events/?league=27&date_from=2026-06-01&date_to=2026-07-30';
    let mappedCount = 0;

    while (url) {
      const response = await axios.get(url, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const apiGames = response.data.results || [];
      
      for (const game of apiGames) {
        // Formato da API: "2026-06-11 16:00"
        const apiTimeFull = game.event_date.substring(0, 16).replace('T', ' ');

        const match = matchesInDb.find(m => {
          // Converte seu "11/06/2026" para "2026-06-11"
          const [d, mMonth, y] = m.date.split('/');
          const dbTimeFull = `${y}-${mMonth}-${d} ${m.time}`; // "2026-06-11 16:00"

          // 1. Se a Data e Hora batem exatamente
          if (apiTimeFull === dbTimeFull) {
            const h = translate(game.home_team);
            const aw = translate(game.away_team);
            const a = normalize(m.teamA);
            const b = normalize(m.teamB);

            // 2. Verifica se pelo menos UM dos times coincide
            return (a === h || a === aw || b === h || b === aw);
          }
          return false;
        });

        if (match) {
          await Match.updateOne(
            { _id: match._id },
            { $set: { apiId: game.id, lastSync: new Date() } }
          );
          console.log(`✅ MAPEADO: ${match.teamA} x ${match.teamB} (ID: ${game.id})`);
          mappedCount++;
        }
      }
      url = response.data.next;
    }

    console.log(`\n🎯 FIM: ${mappedCount}/${matchesInDb.length} jogos mapeados com sucesso.`);

  } catch (err) {
    console.error('❌ ERRO NO SCRIPT:', err.message);
  }
}

module.exports = mapApiIds;
