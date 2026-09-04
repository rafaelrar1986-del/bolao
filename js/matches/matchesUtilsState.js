/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesUtilsState(ctx = {}) {
  const get = (name) => ctx[name];

  function syncScoresWithGoals(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    if (!match) return match;
    // Garante que regularTimeScoreA/B existam (mesmo que null)
    if (!('regularTimeScoreA' in match)) match.regularTimeScoreA = null;
    if (!('regularTimeScoreB' in match)) match.regularTimeScoreB = null;
    if (!('qualifiedSideManuallySet' in match)) match.qualifiedSideManuallySet = false;
    return match;
  }

  return {
    syncScoresWithGoals,
  };
}
