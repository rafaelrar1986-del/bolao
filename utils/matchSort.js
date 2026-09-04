'use strict';

const { getMatchTimestamp } = require('./matchDateTime');

function sortMatchesChronologically(a, b) {
  const dateA = getMatchTimestamp(a?.date, a?.time);
  const dateB = getMatchTimestamp(b?.date, b?.time);

  if (dateA !== dateB) {
    if (dateA == null) return 1;
    if (dateB == null) return -1;
    return dateA - dateB;
  }

  const idA =
    parseInt(String(a?.matchId).replace(/\D/g, ''), 10) || 0;

  const idB =
    parseInt(String(b?.matchId).replace(/\D/g, ''), 10) || 0;

  return idA - idB;
}

module.exports = {
  sortMatchesChronologically
};
