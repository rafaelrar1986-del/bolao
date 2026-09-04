'use strict';

const { buildKnockoutTieKey } = require('./knockoutFormat');

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getExplicitConfrontationKey(match) {
  if (!match) return null;
  const candidates = [
    match.knockoutTieKey,
    match.confrontationId,
    match.confrontationID,
    match.tieId,
    match.tieID,
    match.pairId,
    match.pairID
  ];
  const value = candidates.find(v => v !== null && v !== undefined && String(v).trim() !== '');
  return value == null ? null : normalizeKey(value);
}

function getFallbackConfrontationKey(match) {
  if (!match) return null;
  const teamA = String(match.teamA ?? '').trim();
  const teamB = String(match.teamB ?? '').trim();
  if (!teamA || !teamB || normalizeKey(teamA) === normalizeKey(teamB)) return null;
  const stage = match.phaseName || match.roundName || match.phase || match.group || '';
  return normalizeKey(buildKnockoutTieKey(stage, teamA, teamB));
}


function getCanonicalTeamPair(match) {
  if (!match) return null;
  const a = normalizeKey(match.teamA);
  const b = normalizeKey(match.teamB);
  if (!a || !b || a === b) return null;
  return [a, b].sort();
}

function sameTeamPair(a, b) {
  const pa = getCanonicalTeamPair(a);
  const pb = getCanonicalTeamPair(b);
  return Boolean(pa && pb && pa[0] === pb[0] && pa[1] === pb[1]);
}

function validateHomeAwayLegs(legs, expectedLegs = 2) {
  if (!Array.isArray(legs) || legs.length !== expectedLegs || expectedLegs !== 2) {
    return { valid: false, reason: 'expected-two-legs' };
  }
  if (!legs.every(m => m && (m.phase === 'knockout' || m.phase === 'mata-mata'))) {
    return { valid: false, reason: 'not-knockout' };
  }
  if (!legs.every(m => getCanonicalTeamPair(m))) {
    return { valid: false, reason: 'missing-teams' };
  }
  if (!legs.slice(1).every(m => sameTeamPair(legs[0], m))) {
    return { valid: false, reason: 'different-teams' };
  }

  const explicitKeys = legs.map(getExplicitConfrontationKey);
  if (explicitKeys.some(Boolean) && !(explicitKeys.every(Boolean) && explicitKeys.every(k => k === explicitKeys[0]))) {
    return { valid: false, reason: 'conflicting-explicit-key' };
  }

  const legValues = legs.map(m => Number(m.knockoutLeg));
  if (!legValues.every(Number.isFinite) || new Set(legValues).size !== 2 || !legValues.every(v => v === 1 || v === 2)) {
    return { valid: false, reason: 'invalid-leg-number' };
  }

  const expectedValues = legs.map(m => Number(m.knockoutExpectedLegs));
  if (!expectedValues.every(Number.isFinite) || !expectedValues.every(v => v === 2)) {
    return { valid: false, reason: 'invalid-expected-leg-count' };
  }

  return { valid: true, reason: null };
}

function getKnockoutConfrontationKey(match) {
  return getExplicitConfrontationKey(match) || getFallbackConfrontationKey(match);
}

/**
 * Compara duas partidas como possíveis pernas do mesmo confronto.
 * Se houver identidade explícita, ela deve existir nas duas e ser igual.
 * Isso evita que um tieKey persistido seja confundido com um fallback de equipes.
 */
function sameKnockoutConfrontation(a, b) {
  const ea = getExplicitConfrontationKey(a);
  const eb = getExplicitConfrontationKey(b);
  if (ea || eb) return Boolean(ea && eb && ea === eb);
  const ka = getFallbackConfrontationKey(a);
  const kb = getFallbackConfrontationKey(b);
  return Boolean(ka && kb && ka === kb);
}

module.exports = {
  normalizeKey,
  getExplicitConfrontationKey,
  getFallbackConfrontationKey,
  getKnockoutConfrontationKey,
  sameKnockoutConfrontation,
  getCanonicalTeamPair,
  sameTeamPair,
  validateHomeAwayLegs
};
