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

module.exports = router;
