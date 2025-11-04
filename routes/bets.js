const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const { protect } = require('../middleware/auth');
const router = express.Router();

// ======================
// 🌐 ROTA RAIZ - INFORMATIVA
// ======================
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites do Bolão da Copa 2026!',
    version: '1.0.0',
    endpoints: {
      'GET  /api/bets': 'Esta página de informações',
      'GET  /api/bets/my-bets': 'Buscar meus palpites (protegido)',
      'POST /api/bets/save': 'Salvar palpites (protegido)',
      'GET  /api/bets/status': 'Verificar status (protegido)',
      'GET  /api/bets/leaderboard': 'Ver classificação (protegido)',
      'GET  /api/bets/stats/overview': 'Estatísticas (protegido)',
      'POST /api/bets/simulate-points': 'Simular pontuação (admin)',
      'POST /api/bets/recalculate-all': 'Recalcular pontos (admin)',
      'GET  /api/bets/test': 'Rota de teste (protegido)'
    },
    instructions: 'Use as rotas específicas acima para interagir com a API',
    timestamp: new Date().toISOString()
  });
});

// ======================
// 🎯 BUSCAR PALPITES DO USUÁRIO - COM NOMES DOS TIMES (CORRIGIDO)
// ======================
router.get('/my-bets', protect, async (req, res) => {
  try {
    console.log('🎯 Buscando palpites do usuário:', req.user._id);
    
    const userBet = await Bet.findOne({ user: req.user._id })
      .populate('user', 'name email');

    if (!userBet) {
      console.log('📝 Usuário ainda não enviou palpites');
      return res.json({
        success: true,
        data: null,
        message: 'Você ainda não enviou seus palpites. Use a rota /save para enviar.',
        hasSubmitted: false,
        canEdit: true
      });
    }

    console.log('🔍 Buscando dados dos jogos...');
    
    // 🔥 BUSCAR DADOS DOS JOGOS PARA MOSTRAR NOMES DOS TIMES
    const matches = await Match.find().lean();
    console.log(`✅ Encontrados ${matches.length} jogos no banco`);
    
    // 🔥 ADICIONAR INFORMAÇÕES DOS TIMES AOS PALPITES
    const betsWithTeamNames = userBet.groupMatches.map(bet => {
      const match = matches.find(m => m.matchId === bet.matchId);
      console.log(`🔍 Procurando jogo ${bet.matchId}:`, match ? 'Encontrado' : 'NÃO ENCONTRADO');
      
      return {
        ...bet.toObject ? bet.toObject() : bet,
        teamA: match ? match.teamA : 'Time A',
        teamB: match ? match.teamB : 'Time B', 
        matchName: match ? `${match.teamA} vs ${match.teamB}` : `Jogo ${bet.matchId}`,
        date: match ? match.date : null,
        time: match ? match.time : null,
        group: match ? match.group : null,
        stadium: match ? match.stadium : null,
        status: match ? match.status : 'scheduled'
      };
    });

    console.log('✅ Palpites processados com nomes dos times');

    // Converter userBet para objeto simples para manipulação
    const userBetData = userBet.toObject ? userBet.toObject() : userBet;
    
    res.json({
      success: true,
      data: {
        ...userBetData,
        groupMatches: betsWithTeamNames
      },
      hasSubmitted: userBetData.hasSubmitted,
      canEdit: !userBetData.hasSubmitted
    });

  } catch (error) {
    console.error('❌ ERRO AO BUSCAR PALPITES:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar seus palpites',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ======================
// 💾 SALVAR PALPITES (APENAS UMA VEZ)
// ======================
router.post('/save', protect, async (req, res) => {
  try {
    console.log('💾 Tentando salvar palpites para:', req.user.name);
    
    const { groupMatches, podium } = req.body;
    const userId = req.user._id;

    // 🔥 VALIDAÇÃO DE CAMPOS OBRIGATÓRIOS
    if (!groupMatches || !podium) {
      return res.status(400).json({
        success: false,
        message: 'Dados incompletos. São necessários: groupMatches e podium'
      });
    }

    // 🔥 VALIDAÇÃO DO PÓDIO
    if (!podium.first || !podium.second || !podium.third) {
      return res.status(400).json({
        success: false,
        message: 'Preencha todas as posições do pódio (1º, 2º e 3º lugar)'
      });
    }

    // 🔥 VERIFICAR SE JÁ ENVIOU PALPITES
    let userBet = await Bet.findOne({ user: userId });
    
    if (userBet && userBet.hasSubmitted) {
      console.log('❌ Tentativa de reenvio de palpites:', req.user.email);
      return res.status(409).json({
        success: false,
        message: 'Você já enviou seus palpites! Não é possível alterá-los.',
        firstSubmission: userBet.firstSubmission,
        canEdit: false
      });
    }

    // 🔥 VALIDAR SE OS JOGOS EXISTEM
    const matchIds = Object.keys(groupMatches).map(id => parseInt(id));
    const existingMatches = await Match.find({ 
      matchId: { $in: matchIds } 
    }).select('matchId');
    
    const existingMatchIds = existingMatches.map(m => m.matchId);
    const invalidMatches = matchIds.filter(id => !existingMatchIds.includes(id));
    
    if (invalidMatches.length > 0) {
      return res.status(400).json({
        success: false,
        message: `IDs de jogos inválidos: ${invalidMatches.join(', ')}`
      });
    }

    // ✅ CRIAR OU ATUALIZAR REGISTRO
    const now = new Date();
    
    if (!userBet) {
      userBet = new Bet({ 
        user: userId,
        firstSubmission: now,
        lastUpdate: now,
        hasSubmitted: true
      });
    } else {
      userBet.firstSubmission = userBet.firstSubmission || now;
      userBet.lastUpdate = now;
      userBet.hasSubmitted = true;
    }

    // ✅ PROCESSAR PALPITES DOS JOGOS
    userBet.groupMatches = Object.entries(groupMatches).map(([matchId, bet]) => {
      const score = bet.split('-').map(num => parseInt(num.trim()));
      return {
        matchId: parseInt(matchId),
        bet: bet,
        scoreA: score[0],
        scoreB: score[1],
        points: 0
      };
    });

    // ✅ PROCESSAR PÓDIO
    userBet.podium = {
      first: podium.first.trim(),
      second: podium.second.trim(), 
      third: podium.third.trim()
    };

    userBet.totalPoints = 0;
    userBet.groupPoints = 0;
    userBet.podiumPoints = 0;
    userBet.bonusPoints = 0;

    await userBet.save();
    await userBet.populate('user', 'name email');

    console.log('✅ Palpites salvos com sucesso!');

    res.status(201).json({
      success: true,
      message: 'Palpites enviados com sucesso! Não será possível alterá-los.',
      data: userBet,
      firstSubmission: true,
      canEdit: false,
      submissionDate: userBet.firstSubmission
    });

  } catch (error) {
    console.error('❌ ERRO AO SALVAR PALPITES:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro ao salvar palpites'
    });
  }
});

// ======================
// 🔍 VERIFICAR STATUS DOS PALPITES
// ======================
router.get('/status', protect, async (req, res) => {
  try {
    const userBet = await Bet.findOne({ user: req.user._id });
    
    const status = {
      hasSubmitted: userBet ? userBet.hasSubmitted : false,
      firstSubmission: userBet ? userBet.firstSubmission : null,
      lastUpdate: userBet ? userBet.lastUpdate : null,
      canEdit: !userBet || !userBet.hasSubmitted,
      matchesCount: userBet ? userBet.groupMatches.length : 0,
      hasPodium: userBet ? !!(userBet.podium.first && userBet.podium.second && userBet.podium.third) : false
    };

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('❌ ERRO AO VERIFICAR STATUS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar status dos palpites'
    });
  }
});

// ======================
// 🏆 CLASSIFICAÇÃO (LEADERBOARD) - COM NOMES DOS TIMES
// ======================
router.get('/leaderboard', protect, async (req, res) => {
  try {
    console.log('🏆 Gerando leaderboard...');
    
    const leaderboard = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name email')
      .select('user totalPoints groupPoints podiumPoints bonusPoints lastUpdate podium')
      .sort({ totalPoints: -1, lastUpdate: 1 })
      .lean();

    // Adicionar posição no ranking e informações do pódio
    const rankedLeaderboard = leaderboard.map((bet, index) => ({
      position: index + 1,
      user: bet.user,
      totalPoints: bet.totalPoints || 0,
      groupPoints: bet.groupPoints || 0,
      podiumPoints: bet.podiumPoints || 0,
      bonusPoints: bet.bonusPoints || 0,
      podium: bet.podium ? {
        first: bet.podium.first,
        second: bet.podium.second,
        third: bet.podium.third
      } : null,
      lastUpdate: bet.lastUpdate
    }));

    res.json({
      success: true,
      data: rankedLeaderboard,
      count: rankedLeaderboard.length,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ ERRO AO BUSCAR LEADERBOARD:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar classificação'
    });
  }
});

// ======================
// 📊 ESTATÍSTICAS DOS PALPITES
// ======================
router.get('/stats/overview', protect, async (req, res) => {
  try {
    const totalBets = await Bet.countDocuments({ hasSubmitted: true });
    const totalUsers = await Bet.distinct('user', { hasSubmitted: true });
    
    // Últimos palpites enviados
    const recentBets = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name')
      .sort({ lastUpdate: -1 })
      .limit(5)
      .select('user lastUpdate');

    // Estatísticas do pódio
    const podiumStats = await Bet.aggregate([
      { $match: { hasSubmitted: true } },
      { $group: {
        _id: '$podium.first',
        count: { $sum: 1 }
      }},
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({
      success: true,
      data: {
        totalSubmissions: totalBets,
        totalParticipants: totalUsers.length,
        recentSubmissions: recentBets,
        topChampions: podiumStats
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO BUSCAR ESTATÍSTICAS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar estatísticas'
    });
  }
});

// ======================
// 🔥 ROTA PARA SIMULAR PONTUAÇÃO (ADMIN)
// ======================
router.post('/simulate-points', protect, async (req, res) => {
  try {
    // Verificar se é admin (simplificado)
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Apenas administradores podem simular pontuação.'
      });
    }

    const { actualMatches, actualPodium } = req.body;
    
    console.log('🎮 SIMULANDO PONTUAÇÃO PARA TODOS OS PALPITES...');

    const bets = await Bet.find({ hasSubmitted: true });
    const simulationResults = [];

    for (const bet of bets) {
      const simulatedPoints = bet.simulatePoints(actualMatches, actualPodium);
      simulationResults.push({
        user: bet.user,
        totalPoints: simulatedPoints.totalPoints,
        groupPoints: simulatedPoints.groupPoints,
        podiumPoints: simulatedPoints.podiumPoints,
        correctBets: simulatedPoints.correctBets
      });
    }

    // Ordenar por pontuação
    simulationResults.sort((a, b) => b.totalPoints - a.totalPoints);

    res.json({
      success: true,
      message: `Simulação concluída para ${simulationResults.length} participantes`,
      data: simulationResults,
      summary: {
        totalParticipants: simulationResults.length,
        highestScore: simulationResults[0]?.totalPoints || 0,
        averageScore: simulationResults.reduce((sum, bet) => sum + bet.totalPoints, 0) / simulationResults.length,
        perfectScores: simulationResults.filter(bet => bet.correctBets === 8).length
      }
    });

  } catch (error) {
    console.error('❌ ERRO NA SIMULAÇÃO:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao simular pontuação'
    });
  }
});

// ======================
// 🔥 ROTA PARA RECALCULAR TODOS OS PONTOS (ADMIN)
// ======================
router.post('/recalculate-all', protect, async (req, res) => {
  try {
    // Verificar se é admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Apenas administradores podem recalcular pontos.'
      });
    }

    const { actualMatches, actualPodium } = req.body;
    
    console.log('🔄 RECALCULANDO TODOS OS PONTOS...');

    const updatedCount = await Bet.recalculateAllPoints(actualMatches, actualPodium);
    
    // Atualizar ranking
    const rankedCount = await Bet.updateRanking();

    res.json({
      success: true,
      message: `Pontos recalculados para ${updatedCount} participantes. Ranking atualizado.`,
      updatedCount,
      rankedCount
    });

  } catch (error) {
    console.error('❌ ERRO AO RECALCULAR PONTOS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao recalcular pontos'
    });
  }
});

// ======================
// 👁️ VER TODOS OS PALPITES (COM BUSCA) - NOVAS ROTAS
// ======================

// 🔍 BUSCAR TODOS OS PALPITES COM FILTROS
router.get('/all-bets', protect, async (req, res) => {
  try {
    const { search, matchId, userId, group, sortBy = 'user' } = req.query;
    
    console.log('🔍 Buscando todos os palpites...', { search, matchId, userId, group });

    // Construir query de busca
    let query = { hasSubmitted: true };
    
    // Busca por usuário
    if (userId) {
      query.user = userId;
    } else if (search) {
      const users = await User.find({
        name: { $regex: search, $options: 'i' }
      }).select('_id');
      
      query.user = { $in: users.map(u => u._id) };
    }

    // Busca por partida específica
    if (matchId) {
      query['groupMatches.matchId'] = parseInt(matchId);
    }

    // Busca por grupo
    if (group) {
      // Primeiro buscar partidas deste grupo
      const matchesInGroup = await Match.find({ 
        group: new RegExp(group, 'i') 
      }).select('matchId');
      
      const matchIds = matchesInGroup.map(m => m.matchId);
      query['groupMatches.matchId'] = { $in: matchIds };
    }

    let betsQuery = Bet.find(query)
      .populate('user', 'name email')
      .select('user groupMatches podium totalPoints groupPoints podiumPoints firstSubmission lastUpdate');

    // Ordenação
    if (sortBy === 'user') {
      betsQuery = betsQuery.sort('user.name');
    } else if (sortBy === 'points') {
      betsQuery = betsQuery.sort('-totalPoints');
    } else if (sortBy === 'date') {
      betsQuery = betsQuery.sort('-firstSubmission');
    }

    const allBets = await betsQuery.lean();

    // Buscar dados das partidas para mostrar nomes dos times
    const matches = await Match.find().lean();
    
    // Enriquecer dados com informações das partidas
    const enrichedBets = allBets.map(bet => {
      const enrichedMatches = bet.groupMatches.map(betMatch => {
        const match = matches.find(m => m.matchId === betMatch.matchId);
        return {
          ...betMatch,
          teamA: match ? match.teamA : 'Time A',
          teamB: match ? match.teamB : 'Time B',
          matchName: match ? `${match.teamA} vs ${match.teamB}` : `Jogo ${betMatch.matchId}`,
          date: match ? match.date : null,
          group: match ? match.group : null,
          status: match ? match.status : 'scheduled'
        };
      });

      return {
        ...bet,
        groupMatches: enrichedMatches,
        userName: bet.user.name,
        userEmail: bet.user.email
      };
    });

    // Estatísticas da busca
    const stats = {
      totalBets: enrichedBets.length,
      totalUsers: [...new Set(enrichedBets.map(bet => bet.user._id.toString()))].length,
      totalMatches: [...new Set(enrichedBets.flatMap(bet => bet.groupMatches.map(m => m.matchId)))].length
    };

    res.json({
      success: true,
      data: enrichedBets,
      stats: stats,
      searchParams: { search, matchId, userId, group, sortBy }
    });

  } catch (error) {
    console.error('❌ ERRO AO BUSCAR TODOS OS PALPITES:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar palpites'
    });
  }
});

// ======================
// 🔍 BUSCAR PARTIDAS PARA FILTRO
// ======================
router.get('/matches-for-filter', protect, async (req, res) => {
  try {
    const matches = await Match.find()
      .select('matchId teamA teamB group date')
      .sort('matchId');
    
    res.json({
      success: true,
      data: matches
    });
  } catch (error) {
    console.error('❌ ERRO AO BUSCAR PARTIDAS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar partidas'
    });
  }
});

// ======================
// 👥 LISTAR TODOS OS USUÁRIOS PARA FILTRO
// ======================
router.get('/users-for-filter', protect, async (req, res) => {
  try {
    const users = await User.find()
      .select('_id name email')
      .sort('name');
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('❌ ERRO AO BUSCAR USUÁRIOS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar usuários'
    });
  }
});

// ======================
// 📊 ESTATÍSTICAS DETALHADAS DOS PALPITES
// ======================
router.get('/all-bets/stats', protect, async (req, res) => {
  try {
    const totalBets = await Bet.countDocuments({ hasSubmitted: true });
    const totalUsers = await Bet.distinct('user', { hasSubmitted: true });
    
    // Estatísticas de pódio
    const podiumStats = await Bet.aggregate([
      { $match: { hasSubmitted: true } },
      { $group: {
        _id: '$podium.first',
        count: { $sum: 1 }
      }},
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Partidas mais palpites
    const popularMatches = await Bet.aggregate([
      { $match: { hasSubmitted: true } },
      { $unwind: '$groupMatches' },
      { $group: {
        _id: '$groupMatches.matchId',
        betCount: { $sum: 1 }
      }},
      { $sort: { betCount: -1 } },
      { $limit: 5 }
    ]);

    // Enriquecer com nomes das partidas
    const matches = await Match.find();
    const enrichedPopularMatches = popularMatches.map(popular => {
      const match = matches.find(m => m.matchId === popular._id);
      return {
        matchId: popular._id,
        matchName: match ? `${match.teamA} vs ${match.teamB}` : `Jogo ${popular._id}`,
        betCount: popular.betCount
      };
    });

    res.json({
      success: true,
      data: {
        totalParticipants: totalUsers.length,
        totalSubmissions: totalBets,
        topChampions: podiumStats,
        popularMatches: enrichedPopularMatches,
        averagePoints: await calculateAveragePoints()
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO BUSCAR ESTATÍSTICAS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas'
    });
  }
});

// ======================
// 🎯 FUNÇÃO AUXILIAR: CALCULAR MÉDIA DE PONTOS
// ======================
async function calculateAveragePoints() {
  const result = await Bet.aggregate([
    { $match: { hasSubmitted: true } },
    { $group: {
      _id: null,
      averagePoints: { $avg: '$totalPoints' }
    }}
  ]);
  
  return result.length > 0 ? Math.round(result[0].averagePoints * 100) / 100 : 0;
}

// ======================
// 🌐 ATUALIZAR ROTA DE TESTE COM NOVOS ENDPOINTS
// ======================
router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: '✅ Rotas de palpites funcionando perfeitamente!',
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email
    },
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET  /api/bets',
      'GET  /api/bets/my-bets',
      'POST /api/bets/save', 
      'GET  /api/bets/status',
      'GET  /api/bets/leaderboard',
      'GET  /api/bets/stats/overview',
      'GET  /api/bets/all-bets',           // 👈 NOVA
      'GET  /api/bets/matches-for-filter', // 👈 NOVA
      'GET  /api/bets/users-for-filter',   // 👈 NOVA
      'GET  /api/bets/all-bets/stats',     // 👈 NOVA
      'POST /api/bets/simulate-points',
      'POST /api/bets/recalculate-all',
      'GET  /api/bets/test'
    ]
  });
});
module.exports = router;
