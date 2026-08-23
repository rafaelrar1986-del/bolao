'use strict';

// Fase 7 da refatoração de matches.js.
// Este service apenas orquestra chamadas já existentes.
// A implementação oficial continua em pointsService/dailyHistoryService.

const pointsService = require('./pointsService');
const {
  trySaveDailyPoints,
  rebuildLeagueDailyHistory
} = require('./dailyHistoryService');

async function recalculateAllPoints(leagueId) {
  return pointsService.recalculateAllPoints(leagueId);
}

async function saveDailyPoints(matchDate, leagueId) {
  return trySaveDailyPoints(matchDate, leagueId);
}

async function rebuildHistory(leagueId) {
  return rebuildLeagueDailyHistory(leagueId);
}

module.exports = {
  recalculateAllPoints,
  saveDailyPoints,
  rebuildHistory
};
