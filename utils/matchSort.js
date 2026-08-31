'use strict';

function sortMatchesChronologically(a, b) {
  const parseDate = (dStr) => {
    if (!dStr) return '1970-01-01';

    if (dStr.includes('/')) {
      const [day, month, year] = dStr.split('/');
      return `${year}-${month}-${day}`;
    }

    return dStr;
  };

  const dateA = new Date(
    `${parseDate(a.date)}T${a.time || '00:00'}`
  );

  const dateB = new Date(
    `${parseDate(b.date)}T${b.time || '00:00'}`
  );

  if (dateA - dateB !== 0) {
    return dateA - dateB;
  }

  const idA =
    parseInt(String(a.matchId).replace(/\D/g, ''), 10) || 0;

  const idB =
    parseInt(String(b.matchId).replace(/\D/g, ''), 10) || 0;

  return idA - idB;
}

module.exports = {
  sortMatchesChronologically
};
