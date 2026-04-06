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

    let nextUrl = 'https://sports.bzzoiro.com/api/events/?date_from=2026-04-05&date_to=2026-04-05';
    let updatedCount = 0;
    let page = 1;

    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        if (game.league?.id !== 6) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        // --- LÓGICA AUTOMÁTICA DE CLASSIFICAÇÃO (QUALIFIED SIDE) ---
        let autoQualifiedSide = match.qualifiedSide;
        
        // Se for mata-mata e o jogo finalizou, calculamos o vencedor agora
        if (match.phase === 'knockout' && newStatus === 'finished' && !match.qualifiedSide) {
           autoQualifiedSide = determineQualifier(game);
           if (autoQualifiedSide) {
             console.log(`🏆 [Auto-Qualifier] ${match.teamA} x ${match.teamB}: Vencedor definido como [${autoQualifiedSide}]`);
           }
        }

        const changed =
          match.status !== newStatus ||
          match.scoreA !== game.home_score ||
          match.scoreB !== game.away_score ||
          match.minute !== newMinute ||
          match.qualifiedSide !== autoQualifiedSide; 

        if (!changed) continue;

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

        // --- GRAVAÇÃO NO BANCO ---
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.apiStatus = game.status;
        match.minute = newMinute;
        match.penaltiesA = game.home_penalty_score ?? null;
        match.penaltiesB = game.away_penalty_score ?? null;
        match.qualifiedSide = autoQualifiedSide; // AGORA GRAVA NO BANCO

        await match.save();

        // --- PROCESSAMENTO DE PONTOS ---
        // Como o qualifiedSide foi salvo acima, o recálculo dará os 2 pontos corretamente
        if (match.status !== 'finished' && newStatus === 'finished') {
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
      }
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
