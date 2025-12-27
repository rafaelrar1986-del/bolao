const express = require('express');
const router = express.Router();

const PointsHistory = require('../models/PointsHistory');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// =============================
// 🔹 LISTA DE USUÁRIOS
// =============================
router.get('/users/list', protect, async (req, res) => {
  try {
    const users = await User.find({}, '_id name').sort({ name: 1 });
    res.json(users);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ message: 'Erro ao listar usuários' });
  }
});

// =============================
// 🔹 COMPARAÇÃO ENTRE USUÁRIOS
// =============================
router.get('/compare/:userId', protect, async (req, res) => {
  try {
    const { otherUserId } = req.query;

    if (!otherUserId) {
      return res.status(400).json({ message: 'otherUserId é obrigatório' });
    }

    const userHistory = await PointsHistory
      .find({ user: req.params.userId })
      .sort({ date: 1 });

    const otherHistory = await PointsHistory
      .find({ user: otherUserId })
      .sort({ date: 1 });

    res.json({
      user: userHistory,
      other: otherHistory
    });
  } catch (err) {
    console.error('Erro na comparação de histórico:', err);
    res.status(500).json({ message: 'Erro ao comparar histórico' });
  }
});

// =============================
// 🔹 HISTÓRICO POR USUÁRIO
// =============================
router.get('/:userId', protect, async (req, res) => {
  try {
    const history = await PointsHistory
      .find({ user: req.params.userId })
      .sort({ date: 1 });

    res.json(history);
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
    res.status(500).json({ message: 'Erro ao buscar histórico' });
  }
});

// =============================
// 🔹 RANKING HISTÓRICO (COM EMPATE)
// =============================
router.get('/ranking/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;

    // Todas as datas únicas
    const dates = await PointsHistory.distinct('date');
    dates.sort((a, b) => new Date(a) - new Date(b));

    const timeline = [];

    for (const date of dates) {
      const dayHistory = await PointsHistory
        .find({ date })
        .populate('user', '_id name')
        .lean();

      // Ordena por pontos desc
      dayHistory.sort((a, b) => b.points - a.points);

      let currentRank = 0;
      let lastPoints = null;

      dayHistory.forEach((h, index) => {
        if (lastPoints === null || h.points < lastPoints) {
          currentRank += 1;
        }
        h.rank = currentRank;
        lastPoints = h.points;
      });

      const me = dayHistory.find(
        h => String(h.user._id) === String(userId)
      );

      if (me) {
        timeline.push({
          date,
          rank: me.rank,
          points: me.points
        });
      }
    }

    res.json(timeline);
  } catch (err) {
    console.error('Erro ao gerar ranking histórico:', err);
    res.status(500).json({ message: 'Erro ao gerar ranking histórico' });
  }
});

module.exports = router;
