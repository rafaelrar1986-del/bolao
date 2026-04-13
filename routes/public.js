const express = require('express');
const router = express.Router();
const leagueController = require('../controllers/LeagueController');
const { protect } = require('../middleware/auth'); // Se quiser que só logados vejam

// Rota para pegar as ligas que têm jogo
router.get('/active-leagues', protect, leagueController.getActiveLeagues);

module.exports = router;
