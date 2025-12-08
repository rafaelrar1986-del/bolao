// routes/points.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const PointsService = require('../services/pointsService');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

// ============== Definir pódio (admin) ==============
router.post('/process-podium', protect, admin, async (req, res) => {
  try {
    const { first, second, third, fourth } = req.body || {};
    if (!first || !second || !third || !fourth) {
      return res.status(400).json({ success: false, message: 'first, second, third e fourth são obrigatórios' });
    }

    const result = await PointsService.setPodium({ first, second, third, fourth });
    return res.json({
      success: true,
      message: 'Pódio definido e pontos recalculados',
      updated: result.updated
    });
  } catch (err) {
    console.error('❌ process-podium:', err);
    res.status(500).json({ success: false, message: 'Erro ao processar pódio' });
  }
});

// ============== Recalcular todos os pontos (admin) ==============
router.post('/recalculate-all', protect, admin, async (req, res) => {
  try {
    const result = await PointsService.recalculateAllPoints();
    return res.json({
      success: true,
      message: `Pontos recalculados`,
      updated: result.updated
    });
  } catch (err) {
    console.error('❌ recalculate-all:', err);
    res.status(500).json({ success: false, message: 'Erro ao recalcular pontos' });
  }
});

// ============== Checagem de integridade (admin) ==============
router.get('/integrity-check', protect, admin, async (req, res) => {
  try {
    const betsCount = await Bet.countDocuments({});
    const finishedMatches = await Match.countDocuments({ status: 'finished' });
    const scheduledMatches = await Match.countDocuments({ status: 'scheduled' });
    const inProgressMatches = await Match.countDocuments({ status: 'in_progress' });

    return res.json({
      success: true,
      data: {
        betsCount,
        matches: {
          finished: finishedMatches,
          scheduled: scheduledMatches,
          in_progress: inProgressMatches
        }
      }
    });
  } catch (err) {
    console.error('❌ integrity-check:', err);
    res.status(500).json({ success: false, message: 'Erro ao verificar integridade' });
  }
});

module.exports = router;
