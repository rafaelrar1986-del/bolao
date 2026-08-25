const express = require('express');
const User = require('../models/User');
const Bet = require('../models/Bet');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * ======================
 * 👤 PERFIL PÚBLICO DO USUÁRIO
 * ======================
 * GET /api/users/:id/profile
 *
 * Retorna:
 * - dados básicos do usuário
 * - estatísticas do bolão (se houver apostas enviadas)
 *
 * 🔐 Protegido (usuário precisa estar logado)
 */
router.get('/:id/profile', protect, async (req, res) => {
  try {
    const userId = req.params.id;

    // 🔎 Usuário básico
    const user = await User.findById(userId)
      .select('name createdAt avatar')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // 🏆 Aposta enviada (se existir)
    const bet = await Bet.findOne({
      user: userId,
      hasSubmitted: true
    })
      .select(
        'hasSubmitted totalPoints groupPoints podiumPoints bonusPoints firstSubmission lastUpdate'
      )
      .lean();

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          createdAt: user.createdAt,
          avatar: user.avatar || null
        },
        stats: bet
          ? {
              hasSubmitted: true,
              totalPoints: bet.totalPoints || 0,
              groupPoints: bet.groupPoints || 0,
              podiumPoints: bet.podiumPoints || 0,
              bonusPoints: bet.bonusPoints || 0,
              firstSubmission: bet.firstSubmission || null,
              lastUpdate: bet.lastUpdate || null
            }
          : {
              hasSubmitted: false,
              totalPoints: 0,
              groupPoints: 0,
              podiumPoints: 0,
              bonusPoints: 0
            }
      }
    });

  } catch (err) {
    console.error('GET /api/users/:id/profile error:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar perfil do usuário'
    });
  }
});

module.exports = router;
