function toLeagueId(leagueId) {
  return leagueId != null
    ? String(leagueId).trim()
    : 'default';
}

module.exports = {
  toLeagueId
};
