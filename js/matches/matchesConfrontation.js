// Regras puras de confrontos do mata-mata.
// Este módulo NÃO conhece DOM, STATE global, pontuação ou API.
// A mesma regra é consumida por matches4.js e frontendScoring.js.

import { isKnockoutMatch, parseMatchDate } from './matchesUtils.js';

function getRules(settings = {}) {
  return settings?.championshipRules || settings || {};
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getStageKey(match) {
  return normalize(
    match?.roundNumber ?? match?.roundName ?? match?.group ?? ''
  );
}

export function getKnockoutConfrontationInfo(match, allMatches = [], settings = {}) {
  const rules = getRules(settings);

  if (!match || rules?.knockoutFormat !== 'home_away') {
    return { legs: match ? [match] : [], index: 0, first: match || null, second: null };
  }

  const a = normalize(match.teamA);
  const b = normalize(match.teamB);
  const stage = getStageKey(match);
  const matches = Array.isArray(allMatches) ? allMatches : [];

  const legs = matches
    .filter(candidate => {
      if (!isKnockoutMatch(candidate)) return false;
      const ca = normalize(candidate.teamA);
      const cb = normalize(candidate.teamB);
      return getStageKey(candidate) === stage &&
        ((ca === a && cb === b) || (ca === b && cb === a));
    })
    .slice()
    .sort((x, y) =>
      (parseMatchDate(x)?.getTime() || 0) - (parseMatchDate(y)?.getTime() || 0) ||
      Number(x.matchId) - Number(y.matchId)
    );

  const index = Math.max(
    0,
    legs.findIndex(x => Number(x.matchId) === Number(match.matchId))
  );

  return {
    legs,
    index,
    first: legs[0] || match,
    second: legs[1] || null
  };
}

function findBet(allBets, matchId) {
  if (!Array.isArray(allBets)) return null;
  return allBets.find(b => Number(b?.matchId) === Number(matchId)) || null;
}

export function getConfrontationQualifierBet(match, allMatches = [], allBets = [], settings = {}, fallbackQualifier = null) {
  const info = getKnockoutConfrontationInfo(match, allMatches, settings);
  const first = info.first || match;
  if (!first) return null;

  const firstBet = findBet(allBets, first.matchId);
  const firstSide = firstBet?.qualifier ?? firstBet?.qualifiedSide ?? fallbackQualifier;
  if (firstSide !== 'A' && firstSide !== 'B') return null;

  const firstTeam = firstSide === 'A' ? first.teamA : first.teamB;
  if (normalize(match?.teamA) === normalize(firstTeam)) return 'A';
  if (normalize(match?.teamB) === normalize(firstTeam)) return 'B';
  return null;
}

export function resolveKnockoutConfrontationQualifier(match, info, settings = {}) {
  const confrontation = info || { legs: [] };
  const legs = (confrontation.legs || []).slice(0, 2);
  if (!match || legs.length < 2 || !legs.every(leg => leg.status === 'finished')) return null;

  const teamA = normalize(match.teamA);
  const teamB = normalize(match.teamB);

  const totalFor = team => legs.reduce((sum, leg) => {
    const home = normalize(leg.teamA) === team;
    return sum + Number(home ? (leg.scoreA ?? 0) : (leg.scoreB ?? 0));
  }, 0);

  const totalA = totalFor(teamA);
  const totalB = totalFor(teamB);
  if (totalA !== totalB) return totalA > totalB ? 'A' : 'B';

  const rules = getRules(settings);
  if (rules.knockoutAwayGoals) {
    const awayGoals = team => legs.reduce((sum, leg) => {
      const home = normalize(leg.teamA) === team;
      return sum + Number(home ? 0 : (leg.scoreB ?? 0));
    }, 0);
    const awayA = awayGoals(teamA);
    const awayB = awayGoals(teamB);
    if (awayA !== awayB) return awayA > awayB ? 'A' : 'B';
  }

  // Empate após agregado/gol fora: o resultado oficial do segundo jogo
  // (qualifiedSide) é a fonte de desempate definida pelo Admin/backend.
  const last = legs[legs.length - 1];
  const q = last?.qualifiedSide === 'A' || last?.qualifiedSide === 'B'
    ? last.qualifiedSide
    : null;
  if (!q) return null;

  const lastTeamA = normalize(last.teamA);
  if (q === 'A') return lastTeamA === teamA ? 'A' : 'B';
  return lastTeamA === teamA ? 'B' : 'A';
}

export function getKnockoutConfrontationPointContext({
  match,
  betMatch = {},
  allMatches = [],
  allBets = [],
  settings = {},
  fallbackQualifier = null
} = {}) {
  const rules = getRules(settings);
  if (!match || rules?.knockoutFormat !== 'home_away' || !isKnockoutMatch(match)) {
    return {
      match,
      betMatch,
      displayQualifier: betMatch?.qualifier ?? fallbackQualifier ?? null,
      isReturnLeg: false,
      isConfrontationComplete: true,
      firstLeg: match,
      secondLeg: null,
      legs: match ? [match] : []
    };
  }

  const info = getKnockoutConfrontationInfo(match, allMatches, settings);
  if (info.legs.length < 2) {
    return {
      match,
      betMatch,
      displayQualifier: betMatch?.qualifier ?? fallbackQualifier ?? null,
      isReturnLeg: false,
      isConfrontationComplete: false,
      firstLeg: info.first || match,
      secondLeg: info.second || null,
      legs: info.legs
    };
  }

  const firstLeg = info.first;
  const isReturnLeg = Number(match.matchId) !== Number(firstLeg.matchId);
  const complete = info.legs.slice(0, 2).every(leg => leg.status === 'finished');
  const preparedBet = { ...(betMatch || {}) };
  const firstQualifier = getConfrontationQualifierBet(
    match, allMatches, allBets, settings, fallbackQualifier
  );

  if (isReturnLeg) {
    preparedBet.qualifier = null;
    return {
      match,
      betMatch: preparedBet,
      displayQualifier: firstQualifier,
      isReturnLeg: true,
      isConfrontationComplete: complete,
      firstLeg,
      secondLeg: info.second,
      legs: info.legs.slice(0, 2)
    };
  }

  if (!complete) {
    preparedBet.qualifier = null;
    return {
      match,
      betMatch: preparedBet,
      displayQualifier: firstQualifier ?? betMatch?.qualifier ?? fallbackQualifier ?? null,
      isReturnLeg: false,
      isConfrontationComplete: false,
      firstLeg,
      secondLeg: info.second,
      legs: info.legs.slice(0, 2)
    };
  }

  const realQualifier = resolveKnockoutConfrontationQualifier(match, info, settings);
  preparedBet.qualifier = firstQualifier ?? preparedBet.qualifier ?? null;

  return {
    match: { ...match, qualifiedSide: realQualifier },
    betMatch: preparedBet,
    displayQualifier: preparedBet.qualifier,
    isReturnLeg: false,
    isConfrontationComplete: true,
    firstLeg,
    secondLeg: info.second,
    legs: info.legs.slice(0, 2)
  };
}

// Compatibilidade temporária para matches4.js durante a refatoração.
// A lógica de negócio continua sendo a mesma API pura acima.
export function createKnockoutConfrontationHelpers({ STATE, getChampionshipRules, calculateScoringMatchPoints, getFrontendMatchPointStatus } = {}) {
  const allMatches = () => STATE?.matches || [];
  const settings = () => ({ championshipRules: getChampionshipRules ? getChampionshipRules() : {} });

  function context(match, betMatch = {}) {
    return getKnockoutConfrontationPointContext({
      match,
      betMatch,
      allMatches: allMatches(),
      allBets: STATE?.allBets || [],
      settings: settings(),
      fallbackQualifier: STATE?.knockoutQualifiers?.get(Number(match?.matchId)) ||
        STATE?.knockoutQualifiers?.get(String(match?.matchId)) || null
    });
  }

  return {
    getKnockoutConfrontationInfo: match => getKnockoutConfrontationInfo(match, allMatches(), settings()),
    resolveFrontendKnockoutConfrontationQualifier: (match, info = null) =>
      resolveKnockoutConfrontationQualifier(match, info || getKnockoutConfrontationInfo(match, allMatches(), settings()), settings()),
    getKnockoutConfrontationPointContext: context,
    calculateScoringMatchPointsForUI: (betMatch, match, scoringSettings = {}, isPartial = false) => {
      const c = context(match, betMatch);
      return calculateScoringMatchPoints(c.betMatch, c.match, scoringSettings, isPartial);
    },
    getMatchPointStatusForUI: (betMatch, match, scoringSettings = {}, isPartial = false) => {
      const c = context(match, betMatch);
      return getFrontendMatchPointStatus(c.betMatch, c.match, scoringSettings, isPartial);
    },
    getConfrontationQualifierBet: match => getConfrontationQualifierBet(
      match,
      allMatches(),
      STATE?.allBets || [],
      settings(),
      STATE?.knockoutQualifiers?.get(Number(match?.matchId)) ||
        STATE?.knockoutQualifiers?.get(String(match?.matchId)) || null
    )
  };
}
