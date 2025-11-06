const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

/**
 * Função auxiliar para determinar vencedor real
 */
function getWinner(scoreA, scoreB) {
  if (scoreA > scoreB) return 'teamA';
  if (scoreB > scoreA) return 'teamB';
  return 'draw';
}

/**
 * Função auxiliar para converter aposta "A", "B" ou "D" para nome
 */
function betLabel(match, bet) {
  if (!match) return bet;
  if (bet === 'A') return match.teamA;
  if (bet === 'B') return match.teamB;
  return 'Empate';
}

/**
 * Cálculo de pontos simplificado:
 *  • Acertou o vencedor/empate → 1 ponto
 *  • Pódio: 7 / 4 / 2
 */
function calculatePointsForBet(bet, match) {
  if (!match || match.status !== 'finished') return 0;
  const realWinner = getWinner(match.scoreA, match.scoreB);
  return bet.pick === realWinner ? 1 : 0;
}

// ======================
// GET - MINHAS APOSTAS
// ======================
router.get('/my-bets', protect, async (req, res) => {
  try {
    const betDoc = await Bet.findOne({ user: req.user._id }).lean();
    if (!betDoc) {
      return res.json({ success: true, hasSubmitted: false, data: null });
    }

    const matches = await Match.find().lean();

    const bets = betDoc.groupMatches.map(b => {
      const match = matches.find(m => m.matchId === b.matchId);
      return {
        matchId: b.matchId,
        teamA: match?.teamA,
        teamB: match?.teamB,
        pick: betLabel(match, b.pick),
        correct: match?.status === 'finished' ? calculatePointsForBet(b, match) > 0 : null
      };
    });

    res.json({
      success: true,
      hasSubmitted: betDoc.hasSubmitted,
      podium: betDoc.podium,
      bets
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// ======================
// POST - Enviar Palpites
// ======================
router.post('/save', protect, async (req, res) => {
  try {
    const { groupMatches, podium } = req.body;

    let betDoc = await Bet.findOne({ user: req.user._id });
    if (betDoc && betDoc.hasSubmitted) {
      return res.status(409).json({ success: false, message: "Palpites já enviados" });
    }

    if (!betDoc) betDoc = new Bet({ user: req.user._id });

    betDoc.groupMatches = Object.entries(groupMatches).map(([matchId, pick]) => ({
      matchId: Number(matchId),
      pick
    }));

    betDoc.podium = podium;
    betDoc.hasSubmitted = true;
    await betDoc.save();

    res.json({ success: true, message: "Palpites enviados!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// ======================
// GET - TODOS OS PALPITES (FILTROS)
// ======================
router.get('/all-bets', protect, async (req, res) => {
  try {
    const { search, matchId } = req.query;

    let query = { hasSubmitted: true };
    let usersFilter = [];

    if (search) {
      usersFilter = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id');
      query.user = { $in: usersFilter.map(u => u._id) };
    }

    const bets = await Bet.find(query).populate('user', 'name').lean();
    const matches = await Match.find().lean();

    // Organiza por usuário
    const formatted = bets.map(b => {
      const picks = b.groupMatches.map(g => {
        const match = matches.find(m => m.matchId === g.matchId);
        const correct = match?.status === 'finished' ? (getWinner(match.scoreA, match.scoreB) === g.pick) : null;
        return {
          matchId: g.matchId,
          label: match ? `${match.teamA} vs ${match.teamB}` : g.matchId,
          pick: betLabel(match, g.pick),
          correct
        };
      });

      return {
        userId: b.user._id,
        userName: b.user.name,
        picks
      };
    });

    // Caso matchId enviado → filtrar apenas aquele jogo
    if (matchId) {
      formatted.forEach(u => {
        u.picks = u.picks.filter(p => p.matchId === Number(matchId));
      });
    }

    res.json({
      success: true,
      data: formatted
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// ======================
// GET - Listar usuários para filtro
// ======================
router.get('/users-for-filter', protect, async (req, res) => {
  const list = await User.find().select('_id name').sort('name');
  res.json({ success: true, data: list });
});

// ======================
// GET - Listar Partidas para filtro
// ======================
router.get('/matches-for-filter', protect, async (req, res) => {
  const list = await Match.find().select('matchId teamA teamB').sort('matchId');
  res.json({ success: true, data: list });
});

// ======================
// 🔥 ADMIN - RESETAR TODAS APOSTAS
// ======================
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const result = await Bet.deleteMany({});
    res.json({
      success: true,
      message: "✅ Todas as apostas foram resetadas.",
      deleted: result.deletedCount
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
