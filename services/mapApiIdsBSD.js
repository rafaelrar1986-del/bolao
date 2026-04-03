const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🌎 DICIONÁRIO COMPLETO - COPA DO MÉXICO, EUA E CANADÁ 2026
const teamMap = {
  // Américas
  "brazil": "brasil",
  "argentina": "argentina",
  "uruguay": "uruguai",
  "colombia": "colombia",
  "ecuador": "equador",
  "paraguay": "paraguai",
  "chile": "chile",
  "peru": "peru",
  "venezuela": "venezuela",
  "mexico": "mexico",
  "usa": "estados unidos",
  "united states": "estados unidos",
  "canada": "canada",
  "panama": "panama",
  "costa rica": "costa rica",
  "jamaica": "jamaica",

  // Europa
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
  "denmark": "dinamarca",
  "austria": "austria",
  "norway": "noruega",
  "sweden": "suecia",
  "turkey": "turquia",
  "scotland": "escocia",
  "poland": "polonia",
  "serbia": "servia",
  "ukraine": "ucrania",

  // África
  "morocco": "marrocos",
  "senegal": "senegal",
  "egypt": "egito",
  "tunisia": "tunisia",
  "algeria": "argelia",
  "nigeria": "nigeria",
  "cameroon": "camaroes",
  "ghana": "gana",
  "ivory coast": "costa do marfim",
  "cote d'ivoire": "costa do marfim",
  "south africa": "africa do sul",
  "dr congo": "rd congo",

  // Ásia e Oceania
  "japan": "japao",
  "south korea": "coreia do sul",
  "korea republic": "coreia do sul",
  "australia": "australia",
  "iran": "ira",
  "iraq": "iraque",
  "saudi arabia": "arabia saudita",
  "qatar": "catar",
  "uzbekistan": "uzbequistao",
  "china": "china",
  "jordan": "jordania",
  "new zealand": "nova zelandia"
};

// 🔧 NORMALIZAÇÃO ROBUSTA
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, 'c')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 🔁 TRADUÇÃO COM FALLBACK
function translate(name) {
  const n = normalize(name);
  return normalize(teamMap[n] || n);
}

// 🔥 MATCH INTELIGENTE
function isMatch(teamA, teamB, home, away) {
  const h = translate(home);
  const aw = translate(away);
  const a = normalize(teamA);
  const b = normalize(teamB);

  // Verificação cruzada (previne erro de ordem Home/Away)
  const matchNormal = (a === h && b === aw);
  const matchInvertido = (a === aw && b === h);
  const matchParcial = (a.includes(h) && b.includes(aw)) || (a.includes(aw) && b.includes(h));

  return matchNormal || matchInvertido || matchParcial;
}

async function mapApiIds() {
  try {
    console.log('🚀 Iniciando Mapeamento Global da Copa 2026...');

    // Pega todos os jogos do seu banco de dados
    const matchesInDb = await Match.find({});
    console.log(`📊 Jogos no seu banco: ${matchesInDb.length}`);

    // URL Inicial da API (League 27 = World Cup)
    let nextUrl = 'https://sports.bzzoiro.com/api/events/?league=27&date_from=2026-06-01&date_to=2026-07-30&tz=America/Fortaleza';
    let mappedCount = 0;
    let pageCount = 1;

    // 🔄 LOOP DE PAGINAÇÃO
    while (nextUrl) {
      console.log(`📄 Lendo página ${pageCount} da API...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const apiGames = response.data.results || [];
      
      for (const game of apiGames) {
        // Tenta encontrar o jogo correspondente no seu banco
        const match = matchesInDb.find(m => 
          isMatch(m.teamA, m.teamB, game.home_team, game.away_team)
        );

        if (match) {
          // ATUALIZAÇÃO: Salvamos o 'id' da API que é usado nos endpoints de live/details
          const result = await Match.updateOne(
            { _id: match._id },
            { 
              $set: { 
                apiId: game.id,
                apiIdProvider: game.api_id, // ID secundário caso precise
                lastSync: new Date()
              } 
            }
          );

          if (result.modifiedCount > 0) {
            console.log(`✅ MAPEADO: ${match.teamA} x ${match.teamB} (ID: ${game.id})`);
            mappedCount++;
          }
        } else {
          console.log(`⚠️ NÃO ENCONTRADO: ${game.home_team} x ${game.away_team}`);
        }
      }

      // Atualiza para a próxima página (se houver)
      nextUrl = response.data.next;
      pageCount++;
    }

    console.log('\n' + '—'.repeat(40));
    console.log(`🎯 FIM DO PROCESSO`);
    console.log(`✅ Sucessos: ${mappedCount}`);
    console.log(`❌ Falhas: ${matchesInDb.length - mappedCount}`);
    console.log('—'.repeat(40));

  } catch (err) {
    console.error('❌ ERRO NO PROCESSO:', err.response?.data || err.message);
  }
}

module.exports = mapApiIds;
