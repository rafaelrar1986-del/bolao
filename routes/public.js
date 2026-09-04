const express = require('express');
const router = express.Router();
const leagueController = require('../controllers/LeagueController');
const { protect } = require('../middleware/auth'); // Se quiser que só logados vejam

// Rota para pegar os campeonatos ativos, inclusive sem partidas
router.get('/active-leagues', protect, leagueController.getActiveLeagues);

module.exports = router;