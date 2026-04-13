const axios = require('axios');
const Match = require('../models/Match');

const API_KEY = process.env.API_FOOTBALL_KEY;

async function runMigration() {
  try {
    console.log(`🚀 Iniciando migração forcada de LeagueID...`);

    // URL com as datas da Copa que você solicitou
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=2026-06-10&date_to=2026-06-28`;
    let foundCount = 0;
    let updatedCount = 0;

    while (nextUrl) {
      console.log(`📡 Consultando página: ${nextUrl}`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // IMPORTANTE: Buscamos no seu banco (apiId) usando o (id) da API
        // No seu exemplo: apiId no banco é 8287
        const match = await Match.findOne({ apiId: game.id });

        if (match) {
          foundCount++;
          
          // Injetando os dados da liga
          match.leagueId = Number(game.league.id); // Ex: 27
          match.leagueName = game.league.name;     // Ex: "World Cup 2026"

          // Removendo temporariamente a validação de campos obrigatórios para garantir o save
          // caso haja algum campo antigo vazio no seu banco
          await match.save({ validateBeforeSave: false });
          
          console.log(`✅ [${match.leagueId}] ${match.teamA} x ${match.teamB} atualizado.`);
          updatedCount++;
        }
      }

      nextUrl = response.data.next; 
    }

    console.log(`\n--- RELATÓRIO FINAL ---`);
    console.log(`🔎 Jogos encontrados na API: ${foundCount}`);
    console.log(`💾 Jogos atualizados no banco: ${updatedCount}`);

  } catch (err) {
    console.error('❌ Erro Crítico:', err.message);
  }
}

module.exports = runMigration;
