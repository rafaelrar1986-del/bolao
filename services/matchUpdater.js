const axios = require('axios');
const Match = require('../models/Match'); 
const { recalculateAllPoints } = require('./pointsService');
const { trySaveDailyPoints } = require('./dailyHistoryService');

const API_KEY = process.env.API_FOOTBALL_KEY;

const statusMap = {
  notstarted: 'scheduled',
  inprogress: '1_tempo',
  '1st_half': '1_tempo',
  halftime: 'intervalo',
  '2nd_half': '2_tempo',
  extra_time: 'prorrogacao',
  'extra_time_first_half': 'prorrogacao',
  'extra_time_second_half': 'prorrogacao',
  penalties: 'penaltis',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled'
};

/**
 * FUNÇÃO AUXILIAR: Define quem avançou (Mata-mata)
 */
function determineQualifier(game) {
  // 1. Gols no Tempo Normal/Prorrogação
  if (game.home_score > game.away_score) return 'A';
  if (game.away_score > game.home_score) return 'B';

  // 2. Disputa de Pênaltis (se houver empate nos gols)
  if (game.home_penalty_score > game.away_penalty_score) return 'A';
  if (game.away_penalty_score > game.home_penalty_score) return 'B';

  return null;
}

async function updateMatches() {
  try {
    console.log('🚀 [Cron] Iniciando busca global e atualização automática...');

    let nextUrl = 'https://sports.bzzoiro.com/api/events/?date_from=2026-04-10&date_to=2026-04-11';
    let updatedCount = 0;
    let page = 1;

    const allowedLeagues = [4, 32, 33]; // IDs das ligas permitidas

    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // 1. FILTRO DE LIGA
        if (!allowedLeagues.includes(game.league?.id)) continue;

        // 2. BUSCA NO BANCO
        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        // 3. MAPEAMENTO DE DADOS DA API
        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        // 4. LÓGICA AUTOMÁTICA DE CLASSIFICAÇÃO (QUALIFIED SIDE)
        let autoQualifiedSide = match.qualifiedSide;
        
        // Se for mata-mata e o jogo finalizou, calculamos o vencedor agora
        const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
        if (isKnockout && newStatus === 'finished' && !match.qualifiedSide) {
           autoQualifiedSide = determineQualifier(game);
           if (autoQualifiedSide) {
             console.log(`🏆 [Auto-Qualifier] ${match.teamA} x ${match.teamB}: Vencedor definido como [${autoQualifiedSide}]`);
           }
        }

        // 5. VERIFICA SE HOUVE MUDANÇA REAL
        const changed =
          match.status !== newStatus ||
          match.scoreA !== game.home_score ||
          match.scoreB !== game.away_score ||
          match.minute !== newMinute ||
          match.qualifiedSide !== autoQualifiedSide; 

        if (!changed) continue;

        // 6. LOGS DE ATUALIZAÇÃO
        const isOnlyMinuteUpdate = match.status === newStatus && 
                                   match.scoreA === game.home_score && 
                                   match.scoreB === game.away_score;

        if (isOnlyMinuteUpdate) {
          console.log(`⏳ [Minuto] ${match.teamA} x ${match.teamB}: ${match.minute || '0'} ➔ ${newMinute}`);
        } else {
          console.log('='.repeat(50));
          console.log(`⚽ ATUALIZAÇÃO: ${match.teamA} x ${match.teamB}`);
          console.log(`STATUS: ${match.status} ➔ ${newStatus} | PLACAR: ${game.home_score}x${game.away_score}`);
          if (autoQualifiedSide) console.log(`🏁 CLASSIFICADO: ${autoQualifiedSide}`);
        }

        // 7. GRAVAÇÃO NO BANCO
        const oldStatus = match.status; // Guardamos para checar se terminou agora
        
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.apiStatus = game.status;
        match.minute = newMinute;
        match.penaltiesA = game.home_penalty_score ?? null;
        match.penaltiesB = game.away_penalty_score ?? null;
        match.qualifiedSide = autoQualifiedSide;

        await match.save();

        // 8. PROCESSAMENTO DE PONTOS (Somente se o status mudou para finalizado nesta rodada)
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          console.log(`🥇 [Sistema] Processando pontos globais...`);
          try {
            const result = await recalculateAllPoints();
            console.log(`✅ [Sucesso] ${result.updated} usuários atualizados.`);
            await trySaveDailyPoints(game.event_date);
          } catch (procError) {
            console.error(`❌ [Erro Recálculo]:`, procError.message);
          }
        }
        updatedCount++;
      } // Fim do for games

      nextUrl = response.data.next; 
      page++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✨ [Fim da Rodada] Partidas sincronizadas: ${updatedCount}`);
    console.log('='.repeat(50));

  } catch (err) {
    console.error('❌ [Erro Crítico]:', err.message);
  }
}

module.exports = updateMatches;
