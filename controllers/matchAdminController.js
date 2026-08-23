'use strict';

// Fases 3, 4 e 5 da refatoração de matches.js.
// Extração estrutural: nenhuma regra de negócio foi alterada.

const Match = require('../models/Match');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const User = require('../models/User');

const {
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

const { parsePositiveInteger } = require('../utils/validation');
const { requireLeagueId } = require('../utils/league');

const matchHistoryService = require('../services/matchHistoryService');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');

const matchAdminService = require('../services/matchAdminService');

async function addMatch(req, res) {
  return matchAdminService.addMatch({ req, res });
}

async function editMatch(req, res) {
  return matchAdminService.editMatch({ req, res });
}

async function finishMatch(req, res) {
  return matchAdminService.finishMatch({ req, res });
}

async function unfinishMatches(req, res) {
  return matchAdminService.unfinishMatches({ req, res });
}

async function deleteMatches(req, res) {
  return matchAdminService.deleteMatches({ req, res });
}


async function getAllMatches(req, res) {
  return matchAdminService.getAllMatches({ req, res });
}

module.exports = {
  addMatch,
  editMatch,
  finishMatch,
  unfinishMatches,
  deleteMatches,
  getAllMatches
};;
