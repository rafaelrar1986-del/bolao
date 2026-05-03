const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const { recalculateAllPoints } = require('./pointsService');
const { trySaveDailyPoints } = require('./dailyHistoryService');

const API_KEY = process.env.API_FOOTBALL_KEY;
const headers = { Authorization: `Token ${API_KEY}` };

const statusMap = {
  notstarted: 'scheduled',
  inprogress: '1_tempo',
  '1st_half': '1_tempo',
  halftime: 'intervalo',
  '2nd_half': '2_tempo',
  extra_time: 'prorrogacao',
  'extra_time_first_half': '1_tet',
  'extra_time_second_half': '2_tet',
  penalties: 'penaltis',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled'
};

function mapPlayer(p) {
  return {
    id: p.player_id || null,
    api_id: p.api_id || null,
    nome: p.name || "Desconhecido",
    numero: p.jersey_number || null,
    posicao: p.position || null,
    posicaoDetalhada: p.specific_position || null,
    entrou: p.sub_in || null,
    saiu: p.sub_out || null,
    amarelo: p.yellow_card || false,
    vermelho: p.red_card || false,
    gols: p.goals || 0
  };
}

function sortByPosition(players) {
  const ordem = { G: 0, D: 1, M: 2, F: 3 };
  return players.sort((a, b) => (ordem[a.posicao] ?? 9) - (ordem[b.posicao] ?? 9));
}

/**
 * Mapeia o time garantindo que as chaves batam com o Match Model (players/substitutes)
 */
function mapLineupTeam(team) {
  if (!team) return { formation: "", players: [], substitutes: [] };
  return {
    formation: team.formation || "",
    // Ajustado para 'players' e 'substitutes' conforme seu Match Model
    players: sortByPosition((team.players || []).map(mapPlayer)),
    substitutes: (team.substitutes || []).map(mapPlayer)
  };
}

async function updateMatches() {
  try {
    console.log('🚀 UPDATER START');
    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) return;

    const allowedLeagues = robotSettings.api_leagues || [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 286400000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86400000).toISOString().split('T')[0];

    // 1. LIVE MATCHES
    try {
      const liveRes = await axios.get(
        `https://sports.bzzoiro.com/api/live/?tz=America/Fortaleza`,
        { headers, timeout: 10000 }
      );
      if (liveRes.data?.results) {
        await processGameList(liveRes.data.results, allowedLeagues, robotSettings, 'LIVE');
      }
    } catch (e) {
      console.error(`❌ [Erro API LIVE]: ${e.message}`);
    }

    // 2. EVENTS (Yesterday to Tomorrow)
    const leaguesFilter = allowedLeagues.join(',');
    let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${yesterday}&date_to=${tomorrow}&league=${leaguesFilter}&tz=America/Fortaleza&full=true`;

    while (nextUrl) {
      try {
        const response = await axios.get(nextUrl, { headers, timeout: 15000 });
        if (response.data?.results) {
          await processGameList(response.data.results, allowedLeagues, robotSettings, 'EVENTS');
        }
        nextUrl = response.data.next;
      } catch (e) {
        console.error(`❌ [Erro API EVENTS]: ${e.message}`);
        nextUrl = null;
      }
    }
    await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });
  } catch (err) {
    console.error('❌ [Erro Global]:', err);
  }
}

async function processGameList(games, allowedLeagues, robotSettings, source) {
  for (const gameData of games) {
    try {
      if (!gameData.league?.id || !allowedLeagues.includes(gameData.league.id)) continue;

      const match = await Match.findOne({ apiId: gameData.id });
      if (!match) continue;

      let gameDetail = { ...gameData };
      console.log(`\n⚽ GAME ${gameDetail.id} (${source})`);

      const newStatus = statusMap[gameDetail.status] || 'scheduled';
      const statusChanged = match.status !== newStatus;
      

     // ============================================================
    // 🛡️ DETECÇÃO DE INÍCIO DE JOGO (TRAVA, VISIBILIDADE E AUDITORIA)
    // ============================================================
    if (match.status === 'scheduled' && (newStatus !== 'scheduled' && newStatus !== 'cancelled')) {
      
      const configId = `league_${match.leagueId || 1}`;
      
      // ✨ LÓGICA DE IDENTIFICAÇÃO PARA PONTOS CORRIDOS VS COPA
      const lockIdentifier = match.phaseName || match.group;

      console.log(`[SISTEMA] 🔒 Início detectado: ${match.teamA} x ${match.teamB}`);

      // 🔍 VERIFICAÇÃO DE DUPLICIDADE: Só entra se a fase ainda não estiver nos lockedPhases
      // Usamos as configurações carregadas no início da função (robotSettings)
      const isAlreadyLocked = robotSettings.lockedPhases && robotSettings.lockedPhases.includes(lockIdentifier);

      if (!isAlreadyLocked) {
        console.log(`[SISTEMA] 🛡️ Bloqueando Salvamento e Liberando Visibilidade para: ${lockIdentifier}`);

        // 1. Atualiza configurações de segurança e visibilidade no Banco
        // O $addToSet evita duplicatas no array, mas o IF acima evita o re-envio do e-mail
        await Settings.findByIdAndUpdate(configId, {
          $addToSet: { 
            lockedPhases: lockIdentifier,
            unlockedPhases: { $each: [lockIdentifier, 'podium'] } 
          },
          $set: { 
            statsLocked: false,          // Abre visualização geral
            blockSaveBets: true,         // Bloqueia salvamento pontos corridos
            blockSaveKnockout: true      // Bloqueia salvamento mata-mata
          } 
        });

        // 2. Processo de Auditoria (CSV + E-mail Broadcast)
        try {
          console.log(`[SISTEMA] 📑 Gerando auditoria oficial para ${lockIdentifier}...`);
          const csvFile = await auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier);
          
          if (csvFile) {
            const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
            const emails = users.map(u => u.email).filter(e => !!e);

            if (emails.length > 0) {
              const subject = `🔒 Auditoria Oficial: Grade ${lockIdentifier} Trancada`;
              const message = `A bola rolou para a fase: ${lockIdentifier}!\n\nConforme as regras, os palpites para esta grade e as escolhas do Pódio foram trancados. A visualização de todos os palpites já está liberada no site.\n\nSegue em anexo o arquivo de auditoria com a cópia de segurança dos dados de todos os participantes.`;

              await emailService.sendBroadcastEmail(emails, subject, message, csvFile);
              console.log(`[SISTEMA] 📧 Auditoria enviada com sucesso para ${emails.length} participantes.`);
            }
          }
        } catch (auditErr) {
          console.error("❌ Erro no processo de auditoria:", auditErr.message);
        }

        // Atualiza a variável local para evitar que outros jogos no mesmo loop disparem o e-mail
        robotSettings.lockedPhases.push(lockIdentifier);

      } else {
        console.log(`[SISTEMA] ℹ️ Grade ${lockIdentifier} já estava trancada. Pulando envio de auditoria.`);
      }
    }


      // Verificação de Lineup Local: Se não tem, busca no detalhe
      const currentHasPlayers = match.lineups?.home?.players?.length > 0;

      if (!currentHasPlayers) {
        try {
          console.log(`🔎 FETCH DETAIL ${gameDetail.id}`);
          const detailRes = await axios.get(
            `https://sports.bzzoiro.com/api/events/${gameDetail.id}/?spatial=true`,
            { headers, timeout: 8000 }
          );
          if (detailRes.data && detailRes.data.lineups) {
            gameDetail = detailRes.data; 
          }
        } catch (err) {
          console.error(`❌ DETAIL ERROR ${gameDetail.id}:`, err.message);
        }
      }

      // Preparação do Objeto de Update
      const updateData = {
        scoreA: gameDetail.home_score,
        scoreB: gameDetail.away_score,
        status: newStatus,
        minute: gameDetail.current_minute ? `${gameDetail.current_minute}'` : match.minute,
        penaltiesA: gameDetail.penalty_shootout?.home ?? null,
        penaltiesB: gameDetail.penalty_shootout?.away ?? null,
        xg: {
          home: parseFloat(gameDetail.actual_home_xg || gameDetail.home_xg_live || gameDetail.live_stats?.home?.expected_goals) || 0,
          away: parseFloat(gameDetail.actual_away_xg || gameDetail.away_xg_live || gameDetail.live_stats?.away?.expected_goals) || 0
        },
        odds: {
          home: gameDetail.odds_home || null,
          draw: gameDetail.odds_draw || null,
          away: gameDetail.odds_away || null
        }
      };

      // Estatísticas
      if (gameDetail.live_stats) {
        updateData.statistics = gameDetail.live_stats;
        updateData.possession = {
          home: Number(gameDetail.live_stats.home?.ball_possession) || 0,
          away: Number(gameDetail.live_stats.away?.ball_possession) || 0
        };
      }

      // 1. Verificamos se a API trouxe dados de escalação nesta rodada
const apiHasPlayers = gameDetail.lineups?.home?.players?.length > 0;
const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'finished'].includes(newStatus);

if (apiHasPlayers) {
  // SE NÃO TEM JOGADORES: Cria a estrutura inicial (Trava os nomes)
  if (!currentHasPlayers) {
    console.log(`🔥 CRIANDO ESTRUTURA INICIAL DE ESCALAÇÃO: ${gameDetail.id}`);
    updateData.lineups = {
      home: mapLineupTeam(gameDetail.lineups.home),
      away: mapLineupTeam(gameDetail.lineups.away),
      confirmed: gameDetail.lineups?.confirmed || false
    };
  } 
  // SE JÁ TEM JOGADORES E O JOGO ESTÁ ROLANDO: Atualiza apenas o que mudou (minutos/stats)
  else if (isLive) {
    console.log(`🔄 ATUALIZANDO DINAMICA DE JOGO (SUB/GOLS): ${gameDetail.id}`);
    
    // Função auxiliar interna para não repetir código para Home e Away
    const updateStats = async (side) => {
      for (const p of gameDetail.lineups[side].players) {
        // Só dispara o update se houver algo relevante para atualizar
        if (p.sub_out || p.sub_in || p.goals > 0 || p.yellow_card) {
          await Match.updateOne(
            { _id: match._id, [`lineups.${side}.players.player_id`]: p.player_id },
            { 
              $set: { 
                [`lineups.${side}.players.$.saiu`]: p.sub_out,
                [`lineups.${side}.players.$.entrou`]: p.sub_in,
                [`lineups.${side}.players.$.amarelo`]: p.yellow_card,
                [`lineups.${side}.players.$.gols`]: p.goals,
                [`lineups.${side}.players.$.rating`]: p.rating 
              } 
            }
          );
        }
      }
    };

    await updateStats('home');
    await updateStats('away');
  }
}

      
      // Incidentes (Gols, Cartões, Subs, VAR) - VERSÃO COMPLETA CORRIGIDA
      if (Array.isArray(gameDetail.incidents)) {
        updateData.goalsDetail = gameDetail.incidents.map(i => {
          // Fallback robusto para o nome do jogador
          const playerName = i.player_name || i.player || i.player_out || (i.type === 'injuryTime' ? 'Acréscimos' : 'Lance');

          return {
            type: i.type,
            name: playerName,
            min: i.minute,
            extra: i.extra_minute || i.length || null, // Captura 'length' se for injuryTime
            side: i.is_home ? 'home' : 'away',
            // Normaliza o subtipo (card_type para cartões, decision para VAR)
            description: i.card_type || i.goal_type || i.decision || i.subtype || '',
            playerIn: i.player_in || null,
            playerOut: i.player_out || null
          };
        });
      }

      // Execução do Update
      await Match.updateOne({ _id: match._id }, { $set: updateData });
      console.log(`💾 SAVED ${gameDetail.id}`);

      // Recalcular pontos se o jogo acabou
      if (statusChanged && newStatus === 'finished') {
        recalculateAllPoints(match.leagueId || '1')
          .then(() => trySaveDailyPoints(gameDetail.event_date))
          .catch(() => {});
      }

    } catch (err) {
      console.error(`❌ [Erro jogo ${gameData.id}]:`, err.message);
    }
  }
}

module.exports = updateMatches;
