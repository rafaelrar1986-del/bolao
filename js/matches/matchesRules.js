/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesRules(ctx = {}) {
  const get = (name) => ctx[name];

  function getChampionshipRules() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    return STATE.championshipRules || {
      drawIncludesExtraTime: false,
      podiumSize: 4,
      knockoutFormat: 'single',
      knockoutAwayGoals: false
    };
  }

  function getPodiumSize() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getChampionshipRules } = ctx;
    const rules = getChampionshipRules();
    const rawSize = rules?.podiumSize;
    const size = rawSize == null ? 4 : Number(rawSize);
    return Number.isFinite(size) && size >= 0 ? Math.floor(size) : 4;
  }

  function getPodiumPositions() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getPodiumSize } = ctx;
    const size = getPodiumSize();
    const allPositions = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
    return allPositions.slice(0, size);
  }

  return {
    getChampionshipRules,
    getPodiumSize,
    getPodiumPositions,
  };
}
