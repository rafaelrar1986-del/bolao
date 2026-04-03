const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🌎 DICIONÁRIO COMPLETO (API -> SEU BANCO)
const teamMap = {
  // 🏆 SEUS CLASSIFICADOS VIA PLAY-OFF (DE ACORDO COM SUA TABELA)
  "fifa play-off 1": "rd congo",
  "fifa play-off 2": "iraque",
  "uefa play-off a": "bosnia e herzegovina",
  "uefa play-off b": "suecia",
  "uefa play-off c": "turquia",
  "uefa play-off d": "africa do sul",

  // 🌍 SELEÇÕES - TRADUÇÕES E VARIAÇÕES
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
  "czech republic": "republica tcheca",
  "portugal": "portugal",
  "uzbekistan": "uzbequistao",
  "new zealand": "nova zelandia",
  "panama": "panama",
  "haiti": "haiti",
  "curacao": "curacao"
};

// 🔧 FUNÇÃO DE NORMALIZAÇÃO
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, '')    // Mantém números para os Play-offs
    .replace(/\s+/g, ' ')           // Remove espaços duplos
    .trim();
}

// 🔁 TRADUÇÃO USANDO O DICIONÁRIO
function translate(name) {
  const n = normalize(name);
  return normalize(teamMap[n] || n);
}

async function mapApiIds() {
  try {
    console.log('🚀 Iniciando Mapeamento Cego (Data/Hora + Time)...');

    const matchesInDb = await Match.find({});
    console.log(`👉 Total no seu Banco: ${matchesInDb.length} jogos.`);
    
    // URL com league=27 (World Cup) e timezone Fortaleza
    let url = 'https://sports.bzzoiro.com/api/events/?league=27&date_from=2026-06-01&date_to=2026-07-30&tz=America/Fortaleza';
    let mappedCount = 0;

    while (url) {
      const response = await axios.get(url, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const apiGames = response.data.results || [];
      
      for (const game of apiGames) {
        // 🕒 Hora da API (Formatada para "YYYY-MM-DD HH:mm")
        // Exemplo: "2026-06-12T13:00:00" vira "2026-06-12 13:00"
        const apiTime = game.event_date.substring(0, 16).replace('T', ' ');

        const match = matchesInDb.find(m => {
          // 1. Converte a data do seu banco para o fuso de Fortaleza para comparar
          const dbTime = new Date(m.data_hora).toLocaleString("sv-SE", { 
            timeZone: "America/Fortaleza" 
          }).substring(0, 16);

          // 2. Compara se os horários batem
          const timeMatch = (apiTime === dbTime);

          if (timeMatch) {
            // 3. Se o horário bate, basta UM dos times da API estar no seu jogo do banco
            const h = translate(game.home_team);
            const aw = translate(game.away_team);
            const a = normalize(m.teamA);
            const b = normalize(m.teamB);

            // Valida se qualquer time da API (mesmo Play-off) coincide com seu banco
            return (a === h || a === aw || b === h || b === aw);
          }
          return false;
        });

        if (match) {
          // Salvamos o 'id' interno (o curto de 4 dígitos)
          await Match.updateOne(
            { _id: match._id },
            { 
              $set: { 
                apiId: game.id, 
                lastSync: new Date() 
              } 
            }
          );
          console.log(`✅ MAPEADO: ${match.teamA} x ${match.teamB} (Hora: ${apiTime} | ID: ${game.id})`);
          mappedCount++;
        } else {
          console.log(`❌ SEM MATCH: ${game.home_team} x ${game.away_team} às ${apiTime}`);
        }
      }
      
      // Paginação: segue para a próxima página da API se houver
      url = response.data.next;
    }

    console.log('\n' + '='.repeat(40));
    console.log(`🎯 MAPEAMENTO CONCLUÍDO!`);
    console.log(`📊 Total vinculado: ${mappedCount}/${matchesInDb.length}`);
    console.log('='.repeat(40));

  } catch (err) {
    console.error('❌ ERRO NO SCRIPT:', err.message);
  }
}

module.exports = mapApiIds;
