const axios = require('axios');

// Usa a mesma chave que funcionou no seu dump
const API_KEY = process.env.API_FOOTBALL_KEY; 

async function debugSingleMatch(matchId) {
  try {
    console.log(`--- INICIANDO BUSCA DA PARTIDA ID: ${matchId} ---`);
    
    // Rota direta para o evento específico
    const url = `https://sports.bzzoiro.com/api/events/${matchId}/?tz=America/Sao_Paulo`;

    const response = await axios.get(url, {
      headers: { Authorization: `Token ${API_KEY}` }
    });

    const g = response.data;

    // Log formatado para você ver exatamente o que interessa para o banco
    console.log("--------------------------------------------------");
    console.log(`JOGO: ${g.home_team} x ${g.away_team}`);
    console.log(`STATUS ATUAL: ${g.status}`);
    console.log(`PLACAR: ${g.home_score} x ${g.away_score}`);
    console.log(`ID DA API: ${g.id}`);
    console.log(`DATA (BR): ${g.event_date}`);
    console.log("--------------------------------------------------");
    
    // Log do JSON bruto caso você queira ver campos de estatísticas/incidentes
    console.log("JSON COMPLETO PARA INSPEÇÃO:");
    console.log(JSON.stringify(g, null, 2));
    
    console.log('--- FIM DA CONSULTA ---');

  } catch (err) {
    if (err.response) {
        console.error(`Erro na API (${err.response.status}):`, err.response.data);
    } else {
        console.error('Erro ao buscar dados:', err.message);
    }
  }
}

// Chama a função para o ID desejado
debugSingleMatch(8287);
