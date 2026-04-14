// routes/points.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const PointsService = require('../services/pointsService');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

// ============== Definir / atualizar pódio (admin) ==============
router.post('/process-podium', protect, admin, async (req, res) => {
  try {
    const { first, second, third, fourth, leagueId } = req.body || {};

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga não informado' });
    }

    // bloqueia apenas request totalmente vazia nas posições
    if (
      first === undefined &&
      second === undefined &&
      third === undefined &&
      fourth === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: 'Nenhuma posição do pódio informada'
      });
    }

    const result = await PointsService.setPodium({
      first,
      second,
      third,
      fourth,
      leagueId
    });

    return res.json({
      success: true,
      message: 'Pódio atualizado com sucesso e pontos distribuídos',
      updated: result.updated
    });
  } catch (err) {
    console.error('❌ process-podium:', err);
    res.status(500).json({ success: false, message: 'Erro ao processar pódio' });
  }
});

// ============== OBTER PÓDIO OFICIAL (GET) ==============
router.get('/podium', protect, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é necessário' });
    }

    const podium = await PointsService.getPodium(leagueId);

    return res.json({
      success: true,
      data: podium
    });
  } catch (err) {
    console.error('❌ get-podium:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar pódio'
    });
  }
});

// ============== Zerar pódio (admin) ==============
router.post('/podium/reset', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é necessário' });
    }

    const result = await PointsService.resetPodium(leagueId);
    return res.json({
      success: true,
      message: 'Pódio zerado e pontos recalculados para esta liga',
      updated: result.updated
    });
  } catch (err) {
    console.error('❌ reset-podium:', err);
    res.status(500).json({ success: false, message: 'Erro ao zerar pódio' });
  }
});

// ============== Recalcular todos os pontos (admin) ==============
router.post('/recalculate-all', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é necessário' });
    }

    const result = await PointsService.recalculateAllPoints(leagueId);
    return res.json({
      success: true,
      message: `Pontos recalculados com sucesso`,
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
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é necessário' });
    }

    const query = { leagueId };

    const betsCount = await Bet.countDocuments(query);
    const finishedMatches = await Match.countDocuments({ ...query, status: 'finished' });
    const scheduledMatches = await Match.countDocuments({ ...query, status: 'scheduled' });
    const inProgressMatches = await Match.countDocuments({ ...query, status: 'in_progress' });

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
