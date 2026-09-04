'use strict';

function toLeagueId(leagueId) {
  return leagueId != null
    ? String(leagueId).trim()
    : 'default';
}

function requireLeagueId(leagueId) {
  if (leagueId == null || String(leagueId).trim() === '') {
    throw new Error('leagueId é obrigatório');
  }

  return String(leagueId).trim();
}

module.exports = {
  toLeagueId,
  requireLeagueId
};
