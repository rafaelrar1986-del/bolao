const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// -------------------------
// Helpers locais (labels e acertos)
// -------------------------
function outcomeFromScore(a, b) {
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D';
}
function outcomeFromBetString(scoreStr) {
  if (!scoreStr) return null;
  if (scoreStr === 'A' || scoreStr === 'B' || scoreStr === 'D') return scoreStr;
  const m = String(scoreStr).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return outcomeFromScore(a, b);
}
function betChoiceLabel(betStr, teamA, teamB) {
  const out = outcomeFromBetString(betStr);
  if (out === 'A') return teamA;
  if (out === 'B') return teamB;
  if (out === 'D') return 'Empate';
  return betStr || '-';
}

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
      'GET  /api/bets/all-bets': 'Todos os palpites (protegido, com filtros)',
      'GET  /api/bets/matches-for-filter': 'Partidas p/ filtro (protegido)',
      'GET  /api/bets/users-for-filter': 'Usuários p/ filtro (protegido)',
      'GET  /api/bets/all-bets/stats': 'Estatísticas dos palpites (protegido)',
      'POST /api/bets/simulate-points': 'Simular pontuação (admin)',
      'POST /api/bets/recalculate-all': 'Recalcular pontos (admin)',
      'GET  /api/bets/test': 'Rota de teste (protegido)'
    },
    instructions: 'Use as rotas específicas acima para interagir com a API',
    timestamp: new Date().toISOString()
  });
});

// ======================
// 🎯 BUSCAR PALPITES DO USUÁRIO (enriquecido)
// ======================
router.get('/my-bets', protect, async (req, res) => {
  try {
    const userBet = await Bet.findOne({ user: req.user._id })
      .populate('user', 'name email');

    if (!userBet) {
      return res.json({
        success: true,
        data: null,
        message: 'Você ainda não enviou seus palpites. Use a rota /save para enviar.',
        hasSubmitted: false,
        canEdit: true
      });
    }

    const matches = await Match.find().lean();

    const betsWithTeamNames = userBet.groupMatches.map((bet) => {
      const match = matches.find((m) => m.matchId === bet.matchId);
      const teamA = match ? match.teamA : 'Time A';
      const teamB = match ? match.teamB : 'Time B';
      const label = betChoiceLabel(bet.bet, teamA, teamB);

      let isCorrect = null;
      if (match && match.status === 'finished') {
        const realOutcome = outcomeFromScore(match.scoreA, match.scoreB);
        const betOutcome  = outcomeFromBetString(bet.bet);
        isCorrect = !!(betOutcome && betOutcome === realOutcome);
      }

      return {
        ...(bet.toObject ? bet.toObject() : bet),
        teamA,
        teamB,
        matchName: match ? `${teamA} vs ${teamB}` : `Jogo ${bet.matchId}`,
        date: match ? match.date : null,
        time: match ? match.time : null,
        group: match ? match.group : null,
        stadium: match ? match.stadium : null,
        status: match ? match.status : 'scheduled',
        betChoiceLabel: label,
        isCorrect
      };
    });

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
    const { groupMatches, podium } = req.body;
    const userId = req.user._id;

    if (!groupMatches || !podium) {
      return res.status(400).json({
        success: false,
        message: 'Dados incompletos. São necessários: groupMatches e podium'
      });
    }
    if (!podium.first || !podium.second || !podium.third) {
      return res.status(400).json({
        success: false,
        message: 'Preencha todas as posições do pódio (1º, 2º e 3º lugar)'
      });
    }

    let userBet = await Bet.findOne({ user: userId });
    if (userBet && userBet.hasSubmitted) {
      return res.status(409).json({
        success: false,
        message: 'Você já enviou seus palpites! Não é possível alterá-los.',
        firstSubmission: userBet.firstSubmission,
        canEdit: false
      });
    }

    const matchIds = Object.keys(groupMatches).map((id) => parseInt(id, 10));
    const existingMatches = await Match.find({ matchId: { $in: matchIds } }).select('matchId');
    const existingMatchIds = existingMatches.map((m) => m.matchId);
    const invalidMatches = matchIds.filter((id) => !existingMatchIds.includes(id));
    if (invalidMatches.length > 0) {
      return res.status(400).json({
        success: false,
        message: `IDs de jogos inválidos: ${invalidMatches.join(', ')}`
      });
    }

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

    // Salva palpite como "1-0/0-0/0-1" (mantém compatibilidade com front atual)
    userBet.groupMatches = Object.entries(groupMatches).map(([matchId, bet]) => {
      const score = String(bet).split('-').map((n) => parseInt(String(n).trim(), 10));
      return {
        matchId: parseInt(matchId, 10),
        bet: bet,
        scoreA: Number.isFinite(score[0]) ? score[0] : 0,
        scoreB: Number.isFinite(score[1]) ? score[1] : 0,
        points: 0
      };
    });

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
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors
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
      hasPodium: userBet
        ? !!(userBet.podium.first && userBet.podium.second && userBet.podium.third)
        : false
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
// 🏆 CLASSIFICAÇÃO (LEADERBOARD)
// ======================
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const leaderboard = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name email')
      .select('user totalPoints groupPoints podiumPoints bonusPoints lastUpdate podium')
      .sort({ totalPoints: -1, lastUpdate: 1 })
      .lean();

    const rankedLeaderboard = leaderboard.map((bet, index) => ({
      position: index + 1,
      user: bet.user,
      totalPoints: bet.totalPoints || 0,
      groupPoints: bet.groupPoints || 0,
      podiumPoints: bet.podiumPoints || 0,
      bonusPoints: bet.bonusPoints || 0,
      podium: bet.podium
        ? { first: bet.podium.first, second: bet.podium.second, third: bet.podium.third }
        : null,
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
// 📊 ESTATÍSTICAS (simples)
// ======================
router.get('/stats/overview', protect, async (req, res) => {
  try {
    const totalBets = await Bet.countDocuments({ hasSubmitted: true });
    const totalUsers = await Bet.distinct('user', { hasSubmitted: true });

    const recentBets = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name')
      .sort({ lastUpdate: -1 })
      .limit(5)
      .select('user lastUpdate');

    const podiumStats = await Bet.aggregate([
      { $match: { hasSubmitted: true } },
      {
        $group: {
          _id: '$podium.first',
          count: { $sum: 1 }
        }
      },
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
// 👁️ TODOS OS PALPITES (com filtros)
// ======================
router.get('/all-bets', protect, async (req, res) => {
  try {
    const { search, matchId, userId, group, sortBy = 'user' } = req.query;

    let query = { hasSubmitted: true };

    if (userId) {
      query.user = userId;
    } else if (search) {
      const users = await User.find({
        name: { $regex: search, $options: 'i' }
      }).select('_id');
      query.user = { $in: users.map((u) => u._id) };
    }

    if (matchId) {
      query['groupMatches.matchId'] = parseInt(matchId, 10);
    }

    if (group) {
      const matchesInGroup = await Match.find({
        group: new RegExp(group, 'i')
      }).select('matchId');

      const matchIds = matchesInGroup.map((m) => m.matchId);
      query['groupMatches.matchId'] = { $in: matchIds };
    }

    let betsQuery = Bet.find(query)
      .populate('user', 'name email')
      .select('user groupMatches podium totalPoints groupPoints podiumPoints firstSubmission lastUpdate');

    if (sortBy === 'user') {
      betsQuery = betsQuery.sort('user.name');
    } else if (sortBy === 'points') {
      betsQuery = betsQuery.sort('-totalPoints');
    } else if (sortBy === 'date') {
      betsQuery = betsQuery.sort('-firstSubmission');
    }

    const allBets = await betsQuery.lean();

    const matches = await Match.find().lean();

    // Enriquecer com nomes, labels e acerto/erro
    const enrichedBets = allBets.map((bet) => {
      const enrichedMatches = bet.groupMatches.map((betMatch) => {
        const match = matches.find((m) => m.matchId === betMatch.matchId);
        const teamA = match ? match.teamA : 'Time A';
        const teamB = match ? match.teamB : 'Time B';

        const betLabel = betChoiceLabel(betMatch.bet, teamA, teamB);

        let isCorrect = null;
        if (match && match.status === 'finished') {
          const realOutcome = outcomeFromScore(match.scoreA, match.scoreB);
          const betOutcome = outcomeFromBetString(betMatch.bet);
          isCorrect = !!(betOutcome && betOutcome === realOutcome);
        }

        return {
          ...betMatch,
          teamA,
          teamB,
          matchName: match ? `${teamA} vs ${teamB}` : `Jogo ${betMatch.matchId}`,
          date: match ? match.date : null,
          group: match ? match.group : null,
          status: match ? match.status : 'scheduled',
          betChoiceLabel: betLabel,
          isCorrect
        };
      });

      return {
        ...bet,
        groupMatches: enrichedMatches,
        userName: bet.user.name,
        // ocultar e-mail em respostas públicas do front (mas mantemos no objeto raiz)
        // userEmail: bet.user.email,
      };
    });

    const stats = {
      totalBets: enrichedBets.length,
      totalUsers: [...new Set(enrichedBets.map((bet) => String(bet.user._id)))].length,
      totalMatches: [...new Set(enrichedBets.flatMap((bet) => bet.groupMatches.map((m) => m.matchId)))].length
    };

    res.json({
      success: true,
      data: enrichedBets,
      stats,
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
// 🔍 PARTIDAS PARA FILTRO
// ======================
router.get('/matches-for-filter', protect, async (req, res) => {
  try {
    const matches = await Match.find().select('matchId teamA teamB group date').sort('matchId');
    res.json({ success: true, data: matches });
  } catch (error) {
    console.error('❌ ERRO AO BUSCAR PARTIDAS:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
});

// ======================
// 👥 USUÁRIOS PARA FILTRO
// ======================
router.get('/users-for-filter', protect, async (req, res) => {
  try {
    const users = await User.find().select('_id name').sort('name'); // não retornamos email
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('❌ ERRO AO BUSCAR USUÁRIOS:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

// ======================
// 📊 ESTATÍSTICAS DETALHADAS DOS PALPITES
// ======================
router.get('/all-bets/stats', protect, async (req, res) => {
  try {
    const totalBets = await Bet.countDocuments({ hasSubmitted: true });
    const totalUsers = await Bet.distinct('user', { hasSubmitted: true });

    const popularMatchesAgg = await Bet.aggregate([
      { $match: { hasSubmitted: true } },
      { $unwind: '$groupMatches' },
      {
        $group: {
          _id: '$groupMatches.matchId',
          betCount: { $sum: 1 }
        }
      },
      { $sort: { betCount: -1 } },
      { $limit: 5 }
    ]);

    const matches = await Match.find();
    const enrichedPopularMatches = popularMatchesAgg.map((popular) => {
      const match = matches.find((m) => m.matchId === popular._id);
      return {
        matchId: popular._id,
        matchName: match ? `${match.teamA} vs ${match.teamB}` : `Jogo ${popular._id}`,
        betCount: popular.betCount
      };
    });

    // média de pontos total (opcional)
    const avgAgg = await Bet.aggregate([
      { $match: { hasSubmitted: true } },
      { $group: { _id: null, avgTotal: { $avg: '$totalPoints' } } }
    ]);

    res.json({
      success: true,
      data: {
        totalParticipants: totalUsers.length,
        totalSubmissions: totalBets,
        popularMatches: enrichedPopularMatches,
        averagePoints: avgAgg[0]?.avgTotal ? Math.round(avgAgg[0].avgTotal * 100) / 100 : 0
      }
    });
  } catch (error) {
    console.error('❌ ERRO AO BUSCAR ESTATÍSTICAS:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas' });
  }
});

// ======================
// 🌐 TEST
// ======================
router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: '✅ Rotas de palpites funcionando!',
    user: { id: req.user._id, name: req.user.name, email: req.user.email },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
