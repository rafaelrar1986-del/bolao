const express = require('express');
const router = express.Router();

const { protect, admin } = require('../middleware/auth');

// ⚠️ ENDPOINT DESCONTINUADO
// O histórico diário agora é salvo automaticamente
// via dailyHistoryService, usando a DATA REAL do jogo.
// Este endpoint foi mantido apenas para compatibilidade.

router.post('/rounds/:round/save-points', protect, admin, async (req, res) => {
  return res.status(410).json({
    success: false,
    message:
      'Endpoint descontinuado. A pontuação diária é salva automaticamente por data quando os jogos do dia são finalizados.'
  });
});

module.exports = router;
