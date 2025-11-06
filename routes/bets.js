const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

// ======================
// 🌐 ROTA RAIZ - INFO
// ======================
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites do Bolão 2026',
    version: '1.0.0'
  });
});

// ======================
// 🎯 BUSCAR MEUS PALPITES
// ======================
router.get('/my-bets', protect, async (req, res) => {
  try {
    const bet = await Bet.findOne({ user: req.user._id }).lean();

    const matches = await Match.find().lean();

    if (!bet) {
      return res.json({
        success: true,
        data: null,
        hasSubmitted: false
      });
    }

    // Enriquecer com nomes dos times
    bet.groupMatches = bet.groupMatches.map(b => {
      const m = matches.find(x => x.matchId === b.matchId);
      return {
        ...b,
        matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${b.matchId}`,
        teamA: m?.teamA,
        teamB: m?.teamB,
        status: m?.status
      };
    });

    return res.json({
      success: true,
      data: bet,
      hasSubmitted: bet.hasSubmitted
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({ success: false });
  }
});

// ======================
// 💾 SALVAR PALPITES
// ======================
router.post('/save', protect, async (req, res) => {
  try {
    const { groupMatches, podium } = req.body;

    if (!groupMatches || !podium) {
      return res.status(400).json({ success: false, message: 'Dados incompletos' });
    }

    let bet = await Bet.findOne({ user: req.user._id });

    if (bet && bet.hasSubmitted) {
      return res.status(409).json({
        success: false,
        message: 'Você já enviou seus palpites.'
      });
    }

    const now = new Date();

    if (!bet) bet = new Bet({ user: req.user._id });
    
    bet.groupMatches = Object.keys(groupMatches).map(matchId => {
      const choice = groupMatches[matchId];
      return {
        matchId: Number(matchId),
        winner: choice, // 'A', 'B' ou 'draw'
        points: 0
      };
    });

    bet.podium = {
      first: podium.first,
      second: podium.second,
      third: podium.third
    };

    bet.hasSubmitted = true;
    bet.firstSubmission = now;
    bet.lastUpdate = now;

    await bet.save();

    return res.json({ success: true, message: 'Palpites enviados!' });

  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Erro ao salvar palpites' });
  }
});

// ======================
// 🏆 LEADERBOARD
// ======================
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const bets = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name')
      .sort({ totalPoints: -1 });

    res.json({ success: true, data: bets });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ======================
// 👁️ VER TODOS OS PALPITES (com filtros)
// ======================
router.get('/all-bets', protect, async (req, res) => {
  try {
    const { search, matchId } = req.query;

    let query = { hasSubmitted: true };

    if (search) {
      const users = await User.find({
        name: new RegExp(search, 'i')
      }).select('_id');

      query.user = { $in: users.map(u => u._id) };
    }

    if (matchId) {
      query['groupMatches.matchId'] = Number(matchId);
    }

    const bets = await Bet.find(query)
      .populate('user', 'name')
      .lean();

    const matches = await Match.find().lean();

    const formatted = bets.map(b => ({
      userName: b.user.name,
      podium: b.podium,
      totalPoints: b.totalPoints,
      bets: b.groupMatches.map(g => {
        const m = matches.find(x => x.matchId === g.matchId);
        return {
          matchId: g.matchId,
          choice: g.winner,
          matchName: m ? `${m.teamA} vs ${m.teamB}` : '',
          teamA: m?.teamA,
          teamB: m?.teamB,
          status: m?.status
        };
      })
    }));

    res.json({ success: true, data: formatted });

  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao carregar apostas' });
  }
});

// ======================
// 🔥 ADMIN: RESETAR TODAS AS APOSTAS (APAGA TUDO)
// ======================
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const result = await Bet.deleteMany({});

    return res.json({
      success: true,
      message: `Apostas resetadas com sucesso.`,
      deletedCount: result.deletedCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ ERRO AO RESETAR APOSTAS:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao resetar apostas'
    });
  }
});

module.exports = router;
