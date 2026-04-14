const express = require('express');
const router = express.Router();
const { getGroupStandings } = require('../controllers/groupController');

/**
 * @route   GET /api/groups/standings
 * @desc    Calcula a classificação dos grupos de uma liga específica
 * @access  Public (ou Private se você adicionar um middleware de auth)
 * @query   leagueId (Number) - Obrigatório
 * @query   live (Boolean) - Opcional (calcula com jogos em andamento)
 */
router.get('/standings', (req, res, next) => {
    // Log para monitorar qual liga está sendo requisitada no terminal do VSCode/Render
    const { leagueId, live } = req.query;
    console.log(`[ROUTE] Request Standings - League: ${leagueId || '1 (default)'} | Live: ${live || 'false'}`);
    next();
}, getGroupStandings);

module.exports = router;
