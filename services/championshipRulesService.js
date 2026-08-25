'use strict';

// Fonte única da regra de congelamento das regras do campeonato.
// firstMatchStartedAt é permanente e não é resetado ao reabrir uma partida.

function hasChampionshipStarted(settings) {
  return Boolean(settings?.firstMatchStartedAt);
}

function canEditChampionshipRules(settings) {
  return Boolean(settings?.testMode) || !hasChampionshipStarted(settings);
}

function assertChampionshipRulesEditable(settings) {
  if (!canEditChampionshipRules(settings)) {
    const error = new Error(
      'As regras do campeonato não podem ser alteradas após o início da primeira partida.'
    );
    error.code = 'CHAMPIONSHIP_RULES_LOCKED';
    error.statusCode = 400;
    throw error;
  }
}

function isChangingChampionshipRules(body) {
  return Boolean(
    (body?.scoringRules && typeof body.scoringRules === 'object') ||
    (body?.championshipRules && typeof body.championshipRules === 'object') ||
    (body?.prizeZone && typeof body.prizeZone === 'object') ||
    (body?.rankingRules && typeof body.rankingRules === 'object')
  );
}

module.exports = {
  hasChampionshipStarted,
  canEditChampionshipRules,
  assertChampionshipRulesEditable,
  isChangingChampionshipRules
};
