const express = require('express');
const PointsService = require('../services/pointsService');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

// ======================
// 🎯 ROTAS DE PONTUAÇÃO
// ======================

// 🔥 PROCESSAR PONTOS DE UMA PARTIDA
router.post('/process-match/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId);
    
    const result = await PointsService.processMatchPoints(matchId);
    
    res.json({
      success: true,
      message: `Pontos processados para partida ${matchId}`,
      ...result
    });
  } catch (error) {
    console.error('❌ Erro ao processar pontos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar pontos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🏅 PROCESSAR PÓDIO FINAL
router.post('/process-podium', protect, admin, async (req, res) => {
  try {
    const { first, second, third } = req.body;
    
    const result = await PointsService.processPodiumPoints({ first, second, third });
    
    res.json({
      success: true,
      message: 'Pódio processado e pontos calculados!',
      ...result
    });
  } catch (error) {
    console.error('❌ Erro ao processar pódio:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar pódio',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔄 RECALCULAR TODOS OS PONTOS
router.post('/recalculate-all', protect, admin, async (req, res) => {
  try {
    const result = await PointsService.recalculateAllPoints();
    
    res.json({
      success: true,
      message: 'Todos os pontos recalculados!',
      ...result
    });
  } catch (error) {
    console.error('❌ Erro ao recalcular pontos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao recalcular pontos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📈 ESTATÍSTICAS DE PONTUAÇÃO
router.get('/stats', protect, async (req, res) => {
  try {
    const stats = await PointsService.getPointsStatistics();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar estatísticas'
    });
  }
});

// 🎮 SIMULAR PONTUAÇÃO
router.post('/simulate', protect, admin, async (req, res) => {
  try {
    const scenario = req.body;
    
    const result = await PointsService.simulatePoints(scenario);
    
    res.json({
      success: true,
      message: 'Simulação concluída',
      ...result
    });
  } catch (error) {
    console.error('❌ Erro na simulação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro na simulação'
    });
  }
});

// 🔧 VERIFICAR INTEGRIDADE (Admin)
router.get('/integrity-check', protect, admin, async (req, res) => {
  try {
    const report = await PointsService.checkDataIntegrity();
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('❌ Erro na verificação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro na verificação de integridade'
    });
  }
});

// 🌐 ROTA DE STATUS
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: '🎯 Serviço de Pontuação funcionando!',
    version: '1.0.0',
    endpoints: [
      'POST /api/points/process-match/:matchId',
      'POST /api/points/process-podium',
      'POST /api/points/recalculate-all',
      'GET  /api/points/stats',
      'POST /api/points/simulate',
      'GET  /api/points/integrity-check',
      'GET  /api/points/status'
    ]
  });
});

module.exports = router;