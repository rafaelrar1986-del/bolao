const express = require('express');
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');
const { getLeadershipPath } = require('../controllers/leadershipController');
const { resetAllBets } = require('../controllers/adminBetsController');
const { saveBets, saveSingleBet } = require('../controllers/betSaveController');
const { getMyBets } = require('../controllers/myBetsController');
const { getAllBets } = require('../controllers/allBetsController');
const { getMatchesForFilter, getUsersForFilter } = require('../controllers/filtersController');
const { getMoreAccess } = require('../controllers/accessController');

const router = express.Router();

/* ================================================================
   🛠️ HELPERS & CONSTANTES
   ================================================================ */



// ---------- HELPERS DO LEADERSHIP-PATH ----------

const getMatchResult = (a, b) => {
  if (a === undefined || b === undefined || a === null || b === null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
};

const getQualifiedSide = (match, matchResult) => {
  if (match.qualifiedSide) return match.qualifiedSide;
  if (match.penaltiesA != null && match.penaltiesB != null) {
    if (match.penaltiesA > match.penaltiesB) return 'A';
    if (match.penaltiesB > match.penaltiesA) return 'B';
  }
  return matchResult && matchResult !== 'draw' ? matchResult : null;
};

const sortMatchesChronologically = (a, b) => {
  const parseDate = (dStr) => {
    if (!dStr) return '1970-01-01';
    if (dStr.includes('/')) {
      const [day, month, year] = dStr.split('/');
      return `${year}-${month}-${day}`;
    }
    return dStr;
  };
  const dateA = new Date(`${parseDate(a.date)}T${a.time || '00:00'}`);
  const dateB = new Date(`${parseDate(b.date)}T${b.time || '00:00'}`);

  if (dateA - dateB !== 0) return dateA - dateB;
  const idA = parseInt(String(a.matchId).replace(/\D/g, ''), 10) || 0;
  const idB = parseInt(String(b.matchId).replace(/\D/g, ''), 10) || 0;
  return idA - idB;
};

/* ================================================================
   🚀 GET /leadership-path
   ================================================================ */

const { getLeaderboard } = require('../controllers/leaderboardController');
router.get(
  '/leadership-path',
  protect,
  checkPaid,
  blockStatsIfLocked,
  getLeadershipPath
);

/* ================================================================
   🎯 GET /my-bets (Filtrado por Liga)
   ================================================================ */

router.get('/my-bets', protect, checkPaid, getMyBets);

router.post('/save', protect, checkPaid, saveBets);
/* ================================================================
   🎯 POST /single (Salvar palpite individual)
   ================================================================ */

router.post('/single', protect, checkPaid, saveSingleBet);

/* ================================================================
   👁️ GET /all-bets (Com trava de visibilidade por liga)
   ================================================================ */

router.get(
  '/leaderboard',
  protect,
  checkPaid,
  blockStatsIfLocked,
  getLeaderboard
);

router.get('/all-bets', protect, checkPaid, blockStatsIfLocked, getAllBets);

/* ================================================================
   🔍 GET /matches-for-filter
   ================================================================ */

router.get('/matches-for-filter', protect, checkPaid, getMatchesForFilter);
router.post('/admin/reset-all', protect, admin, resetAllBets);

/* ================================================================
   👥 GET /users-for-filter
   ================================================================ */

router.get('/users-for-filter', protect, checkPaid, blockStatsIfLocked, getUsersForFilter);

router.get('/more-access', protect, getMoreAccess);

module.exports = router;
