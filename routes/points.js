// routes/points.js
const express = require('express');
const router = express.Router();

const { protect, admin } = require('../middleware/auth');
const {
  recalcGroupPointsFromFinishedMatches,
  processPodiumForAllBets,
  integrityOverview,
} = require('../services/pointsService');

// ======================
// POST /api/points/recalculate-all  (admin)
// Recalcula APENAS os pontos de JOGOS (fase de grupos) com base nas partidas finalizadas.
// Mantém podiumPoints intocados. totalPoints é refeito = group + podium + bonus.
// ======================
router.post('/recalculate-all', protect, admin, async (req, res) => {
  try {
    const updated = await recalcGroupPointsFromFinishedMatches();
    res.json({
      success: true,
      message: `Pontos de jogos recalculados para ${updated} apostas.`,
      updatedCount: updated,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Erro em /recalculate-all:', err);
    res.status(500).json({ success: false, message: 'Erro ao recalcular pontos' });
  }
});

// ======================
// POST /api/points/process-podium  (admin)
// Recebe { first, second, third } = pódio final real
// Aplica a regra 7/4/2 e atualiza podiumPoints + totalPoints para todos.
// ======================
router.post('/process-podium', protect, admin, async (req, res) => {
  try {
    const { first, second, third } = req.body || {};
    if (!first || !second || !third) {
      return res.status(400).json({ success: false, message: 'Informe first, second e third' });
    }

    const updated = await processPodiumForAllBets({ first, second, third });

    res.json({
      success: true,
      message: `Pódio processado. ${updated} apostas atualizadas (7/4/2).`,
      updatedCount: updated,
      podium: { first, second, third },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Erro em /process-podium:', err);
    res.status(500).json({ success: false, message: 'Erro ao processar pódio' });
  }
});

// ======================
// GET /api/points/integrity-check  (admin)
// Resumo simples de integridade
// ======================
router.get('/integrity-check', protect, admin, async (req, res) => {
  try {
    const info = await integrityOverview();
    res.json({ success: true, data: info });
  } catch (err) {
    console.error('Erro em /integrity-check:', err);
    res.status(500).json({ success: false, message: 'Erro ao verificar integridade' });
  }
});

module.exports = router;
