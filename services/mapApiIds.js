const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

// 🔥 MAPA COMPLETO (PT → EN)
const nameMap = {
  // América
  brasil: 'brazil',
  argentina: 'argentina',
  uruguai: 'uruguay',
  paraguai: 'paraguay',
  equador: 'ecuador',
  colombia: 'colombia',
  estados unidos: 'usa',
  canada: 'canada',
  mexico: 'mexico',
  costa rica: 'costa rica',
  panama: 'panama',
  haiti: 'haiti',
  curaçao: 'curacao',

  // Europa
  alemanha: 'germany',
  espanha: 'spain',
  portugal: 'portugal',
  franca: 'france',
  inglaterra: 'england',
  croacia: 'croatia',
  belgica: 'belgium',
  suica: 'switzerland',
  suecia: 'sweden',
  noruega: 'norway',
  austria: 'austria',
  escocia: 'scotland',
  italia: 'italy',
  holanda: 'netherlands',
  republica tcheca: 'czech republic',

  // África
  marrocos: 'morocco',
  senegal: 'senegal',
  egito: 'egypt',
  gana: 'ghana',
  tunisia: 'tunisia',
  costa do marfim: 'ivory coast',
  rd congo: 'dr congo',
  congo: 'congo',

  // Ásia
  japao: 'japan',
  coreia do sul: 'south korea',
  ira: 'iran',
  iraque: 'iraq',
  arabia saudita: 'saudi arabia',
  uzbequistao: 'uzbekistan',
  jordania: 'jordan',
  catar: 'qatar',

  // Oceania
  australia: 'australia',
  nova zelandia: 'new zealand',

  // Outros
  turquia: 'turkey',
  argelia: 'algeria',
  cabo verde: 'cape verde'
};

// 🔧 NORMALIZAÇÃO
function normalize(str) {
  let s = str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, 'c')
    .trim();

  return nameMap[s] || s;
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
          $set: {
            apiId: found.fixture.id
          }
        }
      );

      console.log(`✅ ${match.teamA} x ${match.teamB} → ${found.fixture.id}`);
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
