// routes/users.js
const express = require('express');
const User = require('../models/User');
const Bet = require('../models/Bet');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ======================
// 👤 PERFIL PÚBLICO DO USUÁRIO
// ======================
router.get('/:id/profile', protect, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId)
      .select('name createdAt')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const bet = await Bet.findOne({ user: userId }).lean();

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          createdAt: user.createdAt
        },
        stats: bet ? {
          hasSubmitted: bet.hasSubmitted,
          totalPoints: bet.totalPoints || 0,
          groupPoints: bet.groupPoints || 0,
          podiumPoints: bet.podiumPoints || 0,
          bonusPoints: bet.bonusPoints || 0,
          firstSubmission: bet.firstSubmission || null,
          lastUpdate: bet.lastUpdate || null
        } : null
      }
    });

  } catch (err) {
    console.error('GET /users/:id/profile error:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar perfil'
    });
  }
});

module.exports = router;

