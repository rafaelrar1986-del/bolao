const express = require('express');
const router = express.Router();
const rankingController = require('../controllers/rankingController');

// Agora o endpoint é /api/bets/partialrank
router.get('/partialrank', rankingController.getRanking);

module.exports = router;
