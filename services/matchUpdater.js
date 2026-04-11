const axios = require('axios');
const Match = require('../models/Match');
const Setting = require('../models/Setting'); // Model de configurações
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
  if (game.home_score > game.away_score) return 'A';
  if (game.away_score > game.home_score) return 'B';
  if (game.home_penalty_score > game.away_penalty_score) return 'A';
  if (game.away_penalty_score > game.home_penalty_score) return 'B';
  return null;
}

/**
 * FUNÇÃO PRINCIPAL: Chamada pelo Cron a cada 1 minuto
 */
async function updateMatches() {
  try {
    // 1. BUSCA CONFIGURAÇÕES DINÂMICAS DO ADMIN
    const settingsArr = await Setting.find({ 
      key: { $in: ['cron_interval', 'api_leagues', 'api_season', 'last_api_run'] } 
    });

    const config = {
      interval: Number(settingsArr.find(s => s.key === 'cron_interval')?.value || 5),
      leagues: settingsArr.find(s => s.key === 'api_leagues')?.value || [4, 6, 32, 33],
      season: settingsArr.find(s => s.key === 'api_season')?.value || 2026,
      lastRun: Number(settingsArr.find(s => s.key === 'last_api_run')?.value || 0)
    };

    // 2. VERIFICA SE ESTÁ NA HORA DE RODAR (Baseado no intervalo do Admin)
    const now = Date.now();
    const diffMinutes = (now - config.lastRun) / (1000 * 60);

    if (diffMinutes < config.interval) {
      // Ainda não deu o tempo, sai silenciosamente
      return; 
    }

    console.log(`🚀 [Cron] Iniciando atualização automática... (Intervalo: ${config.interval}min)`);

   // Data de Ontem
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

// Data de Amanhã (Adiciona 24h ao momento atual)
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

// URL com a janela de segurança expandida
let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}`;

    // 4. LOOP DE PAGINAÇÃO DA API
    while (nextUrl) {
      console.log(`\n📄 PROCESSANDO PÁGINA ${page}...`);
      
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${API_KEY}` }
      });

      const games = response.data.results || [];

      for (const game of games) {
        // Filtro de ligas baseado no que foi definido no Admin
        if (!config.leagues.includes(game.league?.id)) continue;

        const match = await Match.findOne({ apiId: game.id });
        if (!match) continue;

        const newStatus = statusMap[game.status] || 'scheduled';
        const newMinute = game.current_minute ? `${game.current_minute}'` : '';
        
        let autoQualifiedSide = match.qualifiedSide;
        const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata';
        
        if (isKnockout && newStatus === 'finished' && !match.qualifiedSide) {
           autoQualifiedSide = determineQualifier(game);
        }

        const changed =
          match.status !== newStatus ||
          match.scoreA !== game.home_score ||
          match.scoreB !== game.away_score ||
          match.minute !== newMinute ||
          match.qualifiedSide !== autoQualifiedSide; 

        if (!changed) continue;

        const oldStatus = match.status; 
        
        // Atualização do Objeto
        match.scoreA = game.home_score;
        match.scoreB = game.away_score;
        match.status = newStatus;
        match.apiStatus = game.status;
        match.minute = newMinute;
        match.penaltiesA = game.home_penalty_score ?? null;
        match.penaltiesB = game.away_penalty_score ?? null;
        match.qualifiedSide = autoQualifiedSide;

        await match.save();

        // LOG DE ATUALIZAÇÃO RELEVANTE
        if (oldStatus !== newStatus || match.scoreA !== game.home_score || match.scoreB !== game.away_score) {
          console.log(`⚽ ATUALIZADO: ${match.teamA} ${game.home_score}x${game.away_score} ${match.teamB} (${newStatus})`);
        }

        // 5. PROCESSAMENTO DE PONTOS
        if (oldStatus !== 'finished' && newStatus === 'finished') {
          console.log(`🥇 [Sistema] Partida encerrada. Recalculando pontos...`);
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

    // 6. ATUALIZA A ÚLTIMA EXECUÇÃO NO BANCO
    await Setting.findOneAndUpdate(
      { key: 'last_api_run' },
      { value: now },
      { upsert: true }
    );

    console.log(`✨ [Fim da Rodada] Sincronizados: ${updatedCount} | Próxima em: ${config.interval}min`);

  } catch (err) {
    console.error('❌ [Erro Crítico no Updater]:', err.message);
  }
}

module.exports = updateMatches;
