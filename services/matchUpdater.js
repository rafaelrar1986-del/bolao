const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

async function runMigration() {
  try {
    console.log(`🚀 Iniciando migração de LeagueID...`);

    // Usando a URL específica que você forneceu
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=2026-06-10&date_to=2026-06-28`;
    let updatedTotal = 0;

    while (nextUrl) {
      console.log(`📡 Buscando dados em: ${nextUrl}`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // Busca a partida pelo ApiId que você já tem no banco (8287, etc)
        const match = await Match.findOne({ apiId: game.id });

        if (match) {
          // Forçamos a atualização dos novos campos de liga
          match.leagueId = Number(game.league?.id);
          match.leagueName = game.league?.name;
          
          // Opcional: Atualiza também o api_id secundário se estiver vazio
          if (!match.apiId) match.apiId = game.api_id;

          await match.save();
          console.log(`✅ Atualizado: ${match.teamA} x ${match.teamB} -> Liga: ${match.leagueId}`);
          updatedTotal++;
        }
      }

      nextUrl = response.data.next; 
    }

    console.log(`\n✨ MIGRACÃO CONCLUÍDA!`);
    console.log(`📊 Total de partidas carimbadas com LeagueID: ${updatedTotal}`);

  } catch (err) {
    console.error('❌ Erro na migração:', err.message);
  }
}

module.exports = runMigration;
