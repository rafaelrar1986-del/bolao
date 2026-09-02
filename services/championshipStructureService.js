'use strict';

/**
 * Regras estruturais puras do campeonato. Este módulo não acessa banco e não
 * cria partidas: ele transforma a configuração do ADM em invariantes que
 * podem ser reutilizados por ranking, estratégia, validações e geradores.
 */
function normalizeLegs(value) {
  return Number(value) === 2 ? 2 : 1;
}

function getRoundRobinExpectedMatchCount(totalTeams, legs = 1) {
  const n = Math.floor(Number(totalTeams));
  if (!Number.isFinite(n) || n < 2) return 0;
  return (n * (n - 1) / 2) * normalizeLegs(legs);
}

function getGroupExpectedMatchCount(teamsInGroup, legs = 1) {
  return getRoundRobinExpectedMatchCount(teamsInGroup, legs);
}

function isPowerOfTwo(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2) return false;
  let candidate = n;
  while (candidate % 2 === 0) candidate /= 2;
  return candidate === 1;
}

function getPointsRunStructure(championshipRules = {}) {
  const cfg = championshipRules?.pointsRun || {};
  const totalTeams = Math.floor(Number(cfg.totalTeams) || 0);
  const legs = normalizeLegs(cfg.legs);
  return {
    totalTeams,
    legs,
    expectedMatches: getRoundRobinExpectedMatchCount(totalTeams, legs)
  };
}

function getUnmaterializedRoundRobinMatchCount(expectedMatches, materializedMatches = []) {
  const expected = Math.max(0, Math.floor(Number(expectedMatches) || 0));
  const uniqueIds = new Set();
  let anonymousCount = 0;
  for (const match of (Array.isArray(materializedMatches) ? materializedMatches : [])) {
    const id = match?.matchId ?? match?.apiId;
    if (id == null || String(id).trim() === '') anonymousCount++;
    else uniqueIds.add(String(id));
  }
  const materialized = uniqueIds.size + anonymousCount;
  return Math.max(0, expected - materialized);
}

function getGroupStructure(championshipRules = {}) {
  const cfg = championshipRules?.groupQualification || {};
  const totalTeams = Math.floor(Number(cfg.totalTeams) || 0);
  const groupCount = Math.floor(Number(cfg.groupCount) || 0);
  const totalQualified = Math.floor(Number(cfg.totalQualified) || 0);
  const legs = normalizeLegs(cfg.legs);
  const divisible = totalTeams > 0 && groupCount > 0 && totalTeams % groupCount === 0;
  const teamsPerGroup = divisible ? totalTeams / groupCount : 0;
  const expectedMatchesPerGroup = teamsPerGroup >= 2
    ? getGroupExpectedMatchCount(teamsPerGroup, legs)
    : 0;

  return {
    totalTeams,
    groupCount,
    totalQualified,
    legs,
    divisible,
    teamsPerGroup,
    expectedMatchesPerGroup,
    expectedMatches: divisible ? expectedMatchesPerGroup * groupCount : 0,
    qualifiedIsPowerOfTwo: isPowerOfTwo(totalQualified)
  };
}

module.exports = {
  normalizeLegs,
  getRoundRobinExpectedMatchCount,
  getGroupExpectedMatchCount,
  getUnmaterializedRoundRobinMatchCount,
  isPowerOfTwo,
  getPointsRunStructure,
  getGroupStructure
};
