const express = require('express');
const router = express.Router();
// Ajuste: Importando também a nova função getKnockoutMatches do seu controller
const { getGroupStandings, getKnockoutMatches } = require('../controllers/groupController');

/**
 * @route   GET /api/groups/standings
 * @desc    Calcula a classificação dos grupos de uma liga específica
 * @access  Public
 * @query   leagueId (Number) - Obrigatório
 * @query   live (Boolean) - Opcional (calcula com jogos em andamento)
 */
router.get('/standings', (req, res, next) => {
    // Log para monitorar qual liga está sendo requisitada no terminal do VSCode/Render
    const { leagueId, live } = req.query;
    console.log(`[ROUTE] Request Standings - League: ${leagueId || '1 (default)'} | Live: ${live || 'false'}`);
    next();
}, getGroupStandings);

/**
 * @route   GET /api/groups/knockout
 * @desc    Busca as chaves estruturadas do mata-mata (estilo Copa do Mundo)
 * @access  Public
 * @query   leagueId (Number) - Obrigatório
 */
router.get('/knockout', (req, res, next) => {
    // Log para monitorar a requisição das chaves eliminatórias no terminal
    const { leagueId } = req.query;
    console.log(`[ROUTE] Request Knockout Bracket - League: ${leagueId || '1 (default)'}`);
    next();
}, getKnockoutMatches);

module.exports = router;
