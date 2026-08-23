// routes/matches.js
const express = require('express');
const router = express.Router();

// ==========================================
// MODELS & MIDDLEWARES
// ==========================================
const Match = require('../models/Match');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

// ==========================================
// SERVICES
// ==========================================
const { trySaveDailyPoints, rebuildLeagueDailyHistory } = require('../services/dailyHistoryService');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const pointsService = require('../services/pointsService');

// ---- helpers
const {
  VALID_MATCH_PHASES,
  parseMatchDate,
  parseMatchTime,
  getMatchTimestamp,
  compareMatchesChronologically,
  isValidMatchDate,
  isValidMatchTime,
  isKnockoutPhase,
  toOptionalNonNegativeInteger,
  validatePhaseSpecificData,
  toLeagueId
} = require('../services/matchValidationService');




const {
  getLeagues,
  getMatches,
  getMatchTechnical,
  getRules,
  getStats
} = require('../controllers/matchesController');

const {
  addMatch,
  editMatch,
  finishMatch,
  unfinishMatches,
  deleteMatches,
  getAllMatches
} = require('../controllers/matchAdminController');

const { assertChampionshipRulesEditable } = require('../services/championshipRulesService');

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
router.get('/rules/:leagueId', getRules);