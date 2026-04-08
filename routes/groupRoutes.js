const express = require('express');
const router = express.Router();
const { getGroupStandings } = require('../controllers/groupController');

// Rota: GET /api/groups/standings
router.get('/standings', getGroupStandings);

module.exports = router;
