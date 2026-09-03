// routes/matches.js
const express = require('express');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

// ==========================================
// MODELS & MIDDLEWARES
// ==========================================
const {
  getLeagues,
  getMatches,
  getMatchTechnical,
  getRules,
  getStats
} = require('../controllers/matchesController');

const { getTopScorers } = require('../controllers/topScorersController');

const {
  addMatch,
  editMatch,
  finishMatch,
  unfinishMatches,
  deleteMatches,
  getAllMatches
} = require('../controllers/matchAdminController');

router.post('/admin/finish/:matchId', protect, admin, finishMatch);
router.post('/admin/unfinish-bulk', protect, admin, unfinishMatches);
router.delete('/admin/delete-bulk', protect, admin, deleteMatches);

router.put('/admin/edit/:matchId', editMatch);

router.post('/admin/add', addMatch);

router.get('/leagues', getLeagues);
router.get('/', getMatches);
router.get('/match-technical/:matchId', getMatchTechnical);

router.get('/admin/all', protect, admin, getAllMatches);
router.get('/stats', getStats);
router.get('/top-scorers', getTopScorers);
router.get('/rules/:leagueId', getRules);

module.exports = router;
