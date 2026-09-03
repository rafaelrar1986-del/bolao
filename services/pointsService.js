const { getEffectiveKnockoutFormat } = require('../utils/knockoutFormat');
const { getKnockoutConfrontationKey, sameKnockoutConfrontation, validateHomeAwayLegs, getCanonicalTeamPair } = require('../utils/knockoutConfrontationKey');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');
const { calculateGroupStandings } = require('./groupStandingsService');
const { getRoundRobinExpectedMatchCount, isPowerOfTwo } = require('./championshipStructureService');

// ================================================================
// CONFIGURAÇÕES / DEFAULTS
// ================================================================

const DEFAULT_SCORING = Object.freeze({  exactScore: 5,
  scoreTeamA: 1,
  scoreTeamB: 1,
  winner: 2,
  matchExtras: Object.freeze({ qualifier: 3 }),
  topScorer: 10,
  bestAttack: 10,
  worstDefense: 10,
  upset: 15,
  podiumPoints: [20, 15, 10, 5]
});

const DEFAULT_CHAMPIONSHIP_RULES = Object.freeze({
  drawIncludesExtraTime: false,
  winnerFromScore: true,
  podiumSize: 4,
  hasGroupPhase: true,
  hasKnockoutPhase: false,
  hasThirdPlaceMatch: true,
  knockoutFormat: 'single',
  knockoutFinalFormat: 'home_away',
  knockoutAwayGoals: false,
  pointsRun: { totalTeams: 0, legs: 1 },
  groupQualification: {
    totalTeams: 0,
    groupCount: 0,
    totalQualified: 0,
    legs: 1
  }
});

/**
 * Compatibilidade com consumidores que usam este nome.
 * Mantemos uma cópia simples para evitar que alguém altere o default global.
 */
const DEFAULT_SCORING_RULES = DEFAULT_SCORING;


const MATCH_RULE_CONDITIONS = Object.freeze([
  'exactScore',
  'result',
  'scoreTeamA',
  'scoreTeamB',
  'scoreWinner',
  'scoreLoser',
  'totalGoals',
  'goalDifference'
]);

function sanitizeMatchRules(rawRules, championshipRules = DEFAULT_CHAMPIONSHIP_RULES) {
  if (!Array.isArray(rawRules)) return [];

  const hasKnockout = Boolean(championshipRules?.hasKnockoutPhase);

  return rawRules
    .slice(0, 50)
    .map(rule => {
      const points = Number(rule?.points);
      const conditions = Array.isArray(rule?.conditions)
        ? [...new Set(rule.conditions.filter(c => MATCH_RULE_CONDITIONS.includes(c)))]
        : [];

      // Classificado só é uma condição válida quando a competição tem mata-mata.
      const filteredConditions = hasKnockout
        ? conditions
        : conditions.filter(c => c !== 'qualifier');

      return {
        points: Number.isFinite(points) ? Math.max(0, points) : 0,
        conditions: filteredConditions
      };
    })
    .filter(rule => rule.points > 0 && rule.conditions.length > 0);
}

function evaluateMatchRuleCondition(
  condition,
  betMatch,
  refA,
  refB,
  refWinner,
  refQualifier,
  effectiveBetWinner
) {
  const betA = Number(betMatch?.scoreA);
  const betB = Number(betMatch?.scoreB);
  const validA = Number.isFinite(betA);
  const validB = Number.isFinite(betB);

  switch (condition) {
    case 'exactScore':
      return validA && validB && betA === Number(refA) && betB === Number(refB);

    case 'result':
      return Boolean(effectiveBetWinner) && effectiveBetWinner === refWinner;

    case 'scoreTeamA':
      return validA && betA === Number(refA);

    case 'scoreTeamB':
      return validB && betB === Number(refB);

    case 'scoreWinner': {
      // Condição independente: usa APENAS o vencedor real da partida para
      // descobrir qual lado é o "vencedor". Não exige acerto do resultado.
      if (refWinner !== 'A' && refWinner !== 'B') return false;
      const predictedGoals = refWinner === 'A' ? betA : betB;
      const actualGoals = refWinner === 'A' ? Number(refA) : Number(refB);
      return Number.isFinite(predictedGoals) && predictedGoals === actualGoals;
    }

    case 'scoreLoser': {
      // Condição independente: usa APENAS o perdedor real da partida para
      // descobrir qual lado é o "perdedor". Não exige acerto do resultado.
      if (refWinner !== 'A' && refWinner !== 'B') return false;
      const predictedGoals = refWinner === 'A' ? betB : betA;
      const actualGoals = refWinner === 'A' ? Number(refB) : Number(refA);
      return Number.isFinite(predictedGoals) && predictedGoals === actualGoals;
    }

    case 'totalGoals':
      return validA && validB &&
        betA + betB === Number(refA) + Number(refB);

    case 'goalDifference':
      return validA && validB &&
        Math.abs(betA - betB) === Math.abs(Number(refA) - Number(refB));
    default:
      return false;
  }
}

function strMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function sanitizeScoringRules(rawRules) {
  const rules = {
    ...DEFAULT_SCORING,
    ...(rawRules || {})
  };
  const configuredMatchQualifier = Number(rules?.matchExtras?.qualifier);
  rules.matchExtras = {
    qualifier: Number.isFinite(configuredMatchQualifier)
      ? Math.max(0, configuredMatchQualifier)
      : Number(DEFAULT_SCORING.matchExtras?.qualifier || 0)
  };

  const numericKeys = [
    'exactScore',
    'scoreTeamA',
    'scoreTeamB',
    'winner',
    'topScorer',
    'bestAttack',
    'worstDefense',
    'upset'
  ];

  for (const key of numericKeys) {
    const value = Number(rules[key]);
    rules[key] = Number.isFinite(value)
      ? Math.max(0, value)
      : DEFAULT_SCORING[key];
  }

  if (!Array.isArray(rules.podiumPoints)) {
    rules.podiumPoints = [...DEFAULT_SCORING.podiumPoints];
  }

  // matchRules é independente de podiumPoints e precisa ser normalizado
  // sempre. A versão anterior só fazia isso dentro do else acima.
  rules.matchRules = Array.isArray(rules.matchRules) ? rules.matchRules : [];
  rules.groupQualificationRules =
    Array.isArray(rules.groupQualificationRules)
      ? rules.groupQualificationRules
      : [];

  rules.podiumPoints = rules.podiumPoints.map(value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  });

  return rules;
}

function toBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null) return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'sim', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'off', ''].includes(normalized)) return false;
  return Boolean(fallback);
}

function sanitizeChampionshipRules(rawRules) {
  const rules = {
    ...DEFAULT_CHAMPIONSHIP_RULES,
    ...(rawRules || {})
  };

  rules.drawIncludesExtraTime = toBooleanFlag(rules.drawIncludesExtraTime);
  rules.hasGroupPhase = toBooleanFlag(rules.hasGroupPhase, DEFAULT_CHAMPIONSHIP_RULES.hasGroupPhase);
  rules.hasKnockoutPhase = toBooleanFlag(rules.hasKnockoutPhase, DEFAULT_CHAMPIONSHIP_RULES.hasKnockoutPhase);
  rules.hasThirdPlaceMatch = rules.hasKnockoutPhase && toBooleanFlag(rules.hasThirdPlaceMatch, DEFAULT_CHAMPIONSHIP_RULES.hasThirdPlaceMatch);
  rules.knockoutFormat = rules.knockoutFormat === 'home_away' ? 'home_away' : 'single';
  // A Final só pode ser uma exceção quando o mata-mata geral é ida/volta.
  // Se o mata-mata geral for jogo único, a Final obrigatoriamente também é
  // jogo único. Isso mantém backend, Estratégia e criador de partidas na
  // mesma regra de negócio.
  rules.knockoutFinalFormat = rules.knockoutFormat === 'home_away'
    ? (rules.knockoutFinalFormat === 'single' ? 'single' : 'home_away')
    : 'single';
  // A regra de gols fora é válida sempre que ALGUMA etapa do mata-mata
  // configurada em ida/volta puder usá-la, inclusive quando somente a Final
  // é a exceção ao formato geral.
  const anyKnockoutHomeAway =
    rules.knockoutFormat === 'home_away' ||
    rules.knockoutFinalFormat === 'home_away';
  rules.knockoutAwayGoals = anyKnockoutHomeAway && toBooleanFlag(rules.knockoutAwayGoals);

  const pointsRun = {
    ...(DEFAULT_CHAMPIONSHIP_RULES.pointsRun || {}),
    ...(rules.pointsRun || {})
  };
  pointsRun.totalTeams = Math.max(0, Math.floor(Number(pointsRun.totalTeams) || 0));
  pointsRun.legs = Number(pointsRun.legs) === 2 ? 2 : 1;
  rules.pointsRun = pointsRun;

  const groupQualification = {
    ...(DEFAULT_CHAMPIONSHIP_RULES.groupQualification || {}),
    ...(rules.groupQualification || {})
  };
  const legs = Number(groupQualification.legs);
  groupQualification.legs = legs === 2 ? 2 : 1;
  rules.groupQualification = groupQualification;

  const podiumSize = Number(rules.podiumSize);
  rules.podiumSize = Number.isFinite(podiumSize)
    ? Math.min(4, Math.max(0, Math.floor(podiumSize)))
    : DEFAULT_CHAMPIONSHIP_RULES.podiumSize;

  return rules;
}

/**
 * Retorna as regras de pontuação da liga, já normalizadas.
 * É a API pública usada pelos demais módulos.
 */
async function getScoringRules(leagueId = 'default') {
  const id = leagueId != null ? String(leagueId).trim() : 'default';
  const settings = await Settings.findById(id).lean();
  return sanitizeScoringRules(settings?.scoringRules);
}

/**
 * Retorna as regras do campeonato da liga, já normalizadas.
 */
async function getChampionshipRules(leagueId = 'default') {
  const id = leagueId != null ? String(leagueId).trim() : 'default';
  const settings = await Settings.findById(id).lean();
  return sanitizeChampionshipRules(settings?.championshipRules);
}

/**
 * Obtém o placar de referência para pontuação oficial.
 *
 * Para partidas oficiais, somente status=finished é considerado.
 * Quando drawIncludesExtraTime=false, o resultado usado para placar/vencedor
 * é o tempo normal, com fallback para scoreA/scoreB.
 *
 * Partidas simuladas são aceitas para os cálculos de simulação do ranking,
 * mas nunca são persistidas por calculateMatchPoints().
 */
function getMatchReferenceScore(
  match,
  champRules = DEFAULT_CHAMPIONSHIP_RULES,
  isPartial = false
) {
  if (!match) {
    return {
      refA: null,
      refB: null,
      refWinner: null
    };
  }

  const isFinished = match.status === 'finished';
  const isSimulated = Boolean(match.isSimulated);
  const isLivePartial =
    Boolean(isPartial) &&
    !isFinished &&
    !isSimulated &&
    match.status !== 'scheduled';

  // No modo parcial, o placar atual é tratado como a referência
  // exatamente neste instante. Mantém o comportamento da versão
  // anterior à refatoração do bets.js.
  if (isLivePartial) {
    const refA = match.scoreA;
    const refB = match.scoreB;
    let refWinner = null;

    if (refA != null && refB != null) {
      if (Number(refA) > Number(refB)) refWinner = 'A';
      else if (Number(refB) > Number(refA)) refWinner = 'B';
      else refWinner = 'draw';
    }

    return { refA, refB, refWinner };
  }

  if (!isFinished && !isSimulated) {
    return {
      refA: null,
      refB: null,
      refWinner: null
    };
  }

  const useFinalScore = Boolean(
    champRules?.drawIncludesExtraTime ?? false
  );

  let refA = match.scoreA;
  let refB = match.scoreB;

  if (!useFinalScore) {
    refA = match.regularTimeScoreA ?? match.scoreA;
    refB = match.regularTimeScoreB ?? match.scoreB;
  }

  let refWinner = null;

  if (refA != null && refB != null) {
    if (Number(refA) > Number(refB)) refWinner = 'A';
    else if (Number(refB) > Number(refA)) refWinner = 'B';
    else refWinner = 'draw';
  }

  return { refA, refB, refWinner };
}

/**
 * Determina o classificado para uma partida de mata-mata.
 *
 * Oficial: usa qualifiedSide, já resolvido pelo Match.
 * Simulação/parcial: tenta pênaltis e depois o placar.
 */
function getMatchReferenceQualifier(match, refA, refB, isFinished) {
  if (!match) return null;

  const isKnockout =
    match.phase === 'knockout' ||
    match.phase === 'mata-mata';

  if (!isKnockout) return null;

  if (isFinished && match.qualifiedSide) {
    return match.qualifiedSide;
  }

  const penaltiesA = match.penaltiesA;
  const penaltiesB = match.penaltiesB;

  if (
    penaltiesA != null &&
    penaltiesB != null &&
    Number(penaltiesA) !== Number(penaltiesB)
  ) {
    return Number(penaltiesA) > Number(penaltiesB) ? 'A' : 'B';
  }

  if (refA != null && refB != null && Number(refA) !== Number(refB)) {
    return Number(refA) > Number(refB) ? 'A' : 'B';
  }

  return null;
}

/**
 * Retorna o máximo teórico de pontos de uma partida segundo as regras atuais.
 * Mantém essa regra derivada centralizada para telas de estatísticas/simulação.
 */
function isConfiguredMatchPhaseEnabled(match, championshipRules = DEFAULT_CHAMPIONSHIP_RULES) {
  const phase = String(match?.phase || '').trim().toLowerCase();
  if (phase === 'group') return championshipRules?.hasGroupPhase === true;
  if (phase === 'knockout' || phase === 'mata-mata' || phase === 'mata_mata') {
    if (championshipRules?.hasKnockoutPhase !== true) return false;
    if (String(match?.group || match?.phaseName || '').trim() === '3º lugar' && championshipRules?.hasThirdPlaceMatch !== true) return false;
    return true;
  }
  if (phase === 'pontos_corridos' || phase === 'points_run') {
    return championshipRules?.hasGroupPhase === false && championshipRules?.hasKnockoutPhase === false;
  }
  return false;
}

function getMaxPointsPerMatch(
  scoringRules = DEFAULT_SCORING,
  championshipRules = DEFAULT_CHAMPIONSHIP_RULES,
  phaseOrMatch = 'knockout'
) {
  const rules = sanitizeScoringRules(scoringRules);
  const champRules = sanitizeChampionshipRules(championshipRules);
  const isMatchObject = phaseOrMatch && typeof phaseOrMatch === 'object';
  const phase = isMatchObject
    ? String(phaseOrMatch.phase || '').trim().toLowerCase()
    : String(phaseOrMatch || '').trim().toLowerCase();
  const isKnockout = phase === 'knockout' || phase === 'mata-mata' || phase === 'mata_mata';
  const matchForGate = isMatchObject ? phaseOrMatch : { phase };
  if (!isConfiguredMatchPhaseEnabled(matchForGate, champRules)) return 0;

  const matchRules = sanitizeMatchRules(rules.matchRules, {
    ...champRules,
    hasKnockoutPhase: isKnockout
  });

  const maxMatchRule = matchRules.length > 0
    ? Math.max(...matchRules.map(rule => Number(rule.points) || 0), 0)
    : (
      Number(rules.exactScore || 0) +
      Number(rules.scoreTeamA || 0) +
      Number(rules.scoreTeamB || 0) +
      Number(rules.winner || 0)
    );

  // Em ida/volta o bônus de classificado é do CONFRONTO e vale uma única vez.
  // Para um objeto de partida, somente a primeira perna pode receber esse teto.
  let includeQualifier = isKnockout;
  if (isMatchObject && isKnockout) {
    const format = getEffectiveKnockoutFormat(champRules, phaseOrMatch);
    const leg = Number(phaseOrMatch.knockoutLeg);
    includeQualifier = format === 'single' || !Number.isFinite(leg) || leg === 1;
  }

  const matchExtraQualifier = includeQualifier
    ? Math.max(0, Number(rules.matchExtras?.qualifier || 0))
    : 0;

  return Math.max(0, maxMatchRule + matchExtraQualifier);
}

/**
 * Calcula os pontos de UMA partida.
 *
 * Esta é a única função que deve decidir quantos pontos uma aposta de partida
 * recebe. Ela não grava nada no banco.
 *
 * Retorno:
 * {
 *   points,
 *   total,       // alias de compatibilidade
 *   breakdown,
 *   reference: { refA, refB, refWinner, refQualifier }
 * }
 */
function getMatchExtraQualifierPoints(scoringRules, championshipRules, realMatch) {
  if (!championshipRules?.hasKnockoutPhase) return 0;
  if (!realMatch) return 0;
  const phase = String(realMatch.phase || '').trim().toLowerCase();
  if (phase !== 'knockout' && phase !== 'mata-mata' && phase !== 'mata_mata') return 0;
  if (String(realMatch.group || realMatch.phaseName || '').trim() === '3º lugar' && championshipRules?.hasThirdPlaceMatch !== true) return 0;
  const value = Number(scoringRules?.matchExtras?.qualifier);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function calculateMatchPoints(
  betMatch,
  realMatch,
  scoringRules = DEFAULT_SCORING,
  championshipRules = DEFAULT_CHAMPIONSHIP_RULES,
  isPartial = false
) {
  const rules = sanitizeScoringRules(scoringRules);
  const champRules = sanitizeChampionshipRules(championshipRules);

  const breakdown = {
    exactScore: 0,
    scoreTeamA: 0,
    scoreTeamB: 0,
    winner: 0,
    qualifier: 0
  };

  if (!betMatch || !realMatch) {
    return {
      points: 0,
      total: 0,
      breakdown,
      reference: {
        refA: null,
        refB: null,
        refWinner: null,
        refQualifier: null
      }
    };
  }

  // O cálculo oficial e o teto estratégico precisam usar exatamente o mesmo
  // gate estrutural. Fase desconhecida/ilegítima nunca pode ser pontuada.
  if (!isConfiguredMatchPhaseEnabled(realMatch, champRules)) {
    return {
      points: 0,
      total: 0,
      breakdown,
      reference: { refA: null, refB: null, refWinner: null, refQualifier: null }
    };
  }

  const isFinished = realMatch.status === 'finished';
  const isSimulated = Boolean(realMatch.isSimulated);
  const hasReference = isFinished || isSimulated;

  // No cálculo definitivo, somente partidas finalizadas/simuladas entram.
  // No cálculo parcial, uma partida que já começou pode ser avaliada.
  const canCalculate = isPartial
    ? (realMatch.status !== 'scheduled' || isSimulated || isFinished)
    : hasReference;

  if (!canCalculate) {
    return {
      points: 0,
      total: 0,
      breakdown,
      reference: {
        refA: null,
        refB: null,
        refWinner: null,
        refQualifier: null
      }
    };
  }

  const { refA, refB, refWinner } = getMatchReferenceScore(
    realMatch,
    champRules,
    isPartial
  );

  if (refA == null || refB == null) {
    return {
      points: 0,
      total: 0,
      breakdown,
      reference: {
        refA,
        refB,
        refWinner,
        refQualifier: null
      }
    };
  }

  const refQualifier = getMatchReferenceQualifier(
    realMatch,
    refA,
    refB,
    hasReference
  );

  // Classificado é um extra independente da matchRule e exclusivo do mata-mata.
  const matchQualifierPoints = getMatchExtraQualifierPoints(rules, champRules, realMatch);
  if (
    matchQualifierPoints > 0 &&
    betMatch.qualifier != null &&
    refQualifier != null &&
    String(betMatch.qualifier) === String(refQualifier)
  ) {
    breakdown.qualifier = matchQualifierPoints;
  }

  const betA = Number(betMatch.scoreA);
  const betB = Number(betMatch.scoreB);
  const validBetA = Number.isFinite(betA);
  const validBetB = Number.isFinite(betB);

  const isExact =
    validBetA &&
    validBetB &&
    betA === Number(refA) &&
    betB === Number(refB);

  // Quando habilitado e houver pontuação por placar, o winner do palpite
  // é derivado dos próprios gols. Quando desabilitado, o winner salvo pelo
  // usuário permanece independente do placar.
  const winnerFromScore = champRules.winnerFromScore !== false;

  const effectiveBetWinner = winnerFromScore && validBetA && validBetB
    ? (betA > betB ? 'A' : betB > betA ? 'B' : 'draw')
    : betMatch.winner;

  const matchRules = sanitizeMatchRules(rules.matchRules, champRules);

  let matchedRuleIndex = null;
  let matchedRulePoints = 0;
  let matchedConditions = [];

  if (matchRules.length > 0) {
    // Regras diferentes = OU. A primeira regra satisfeita vence.
    for (let i = 0; i < matchRules.length; i++) {
      const rule = matchRules[i];
      const satisfied = rule.conditions.every(condition =>
        evaluateMatchRuleCondition(
          condition,
          betMatch,
          refA,
          refB,
          refWinner,
          refQualifier,
          effectiveBetWinner
        )
      );

      if (satisfied) {
        matchedRuleIndex = i;
        matchedRulePoints = rule.points;
        matchedConditions = [...rule.conditions];
        break;
      }
    }

    // Mantemos o breakdown legado preenchido de forma informativa,
    // sem alterar o valor total da nova regra.
    for (const condition of matchedConditions) {
      if (condition === 'exactScore') breakdown.exactScore = matchedRulePoints;
      if (condition === 'scoreTeamA') breakdown.scoreTeamA = matchedRulePoints;
      if (condition === 'scoreTeamB') breakdown.scoreTeamB = matchedRulePoints;
      if (condition === 'result' || condition === 'scoreWinner' || condition === 'scoreLoser') {
        breakdown.winner = matchedRulePoints;
      }
    }
  } else {
    if (rules.exactScore > 0 && isExact) breakdown.exactScore = rules.exactScore;
    if (rules.scoreTeamA > 0 && validBetA && betA === Number(refA)) breakdown.scoreTeamA = rules.scoreTeamA;
    if (rules.scoreTeamB > 0 && validBetB && betB === Number(refB)) breakdown.scoreTeamB = rules.scoreTeamB;
    if (rules.winner > 0 && effectiveBetWinner && effectiveBetWinner === refWinner) breakdown.winner = rules.winner;
  }

  const qualifierPoints = getMatchExtraQualifierPoints(rules, champRules, realMatch);

  if (
    qualifierPoints > 0 &&
    refQualifier &&
    betMatch.qualifier &&
    String(betMatch.qualifier) === String(refQualifier)
  ) {
    breakdown.qualifier = qualifierPoints;
  }

  const matchRulePoints = matchRules.length > 0
    ? matchedRulePoints
    : (
        Number(breakdown.exactScore) +
        Number(breakdown.scoreTeamA) +
        Number(breakdown.scoreTeamB) +
        Number(breakdown.winner)
      );

  const points = matchRulePoints + Number(breakdown.qualifier || 0);

  breakdown.matchRuleIndex = matchedRuleIndex;
  breakdown.matchRulePoints = matchedRulePoints;
  breakdown.matchedConditions = matchedConditions;

  return {
    points,
    total: points,
    breakdown,
    reference: {
      refA,
      refB,
      refWinner,
      refQualifier
    }
  };
}

/**
 * Calcula os pontos do pódio. Não grava nada.
 */
function calculatePodiumPoints(
  betPodiumArr,
  officialPodiumArr,
  podiumPointsArr,
  podiumSize = 4
) {
  const size = Math.max(0, Math.floor(Number(podiumSize) || 0));
  const breakdown = new Array(size).fill(0);

  for (let i = 0; i < size; i++) {
    const points = Number(podiumPointsArr?.[i]) || 0;

    if (
      points > 0 &&
      strMatch(betPodiumArr?.[i], officialPodiumArr?.[i])
    ) {
      breakdown[i] = points;
    }
  }

  const total = breakdown.reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );

  return {
    points: total,
    total,
    breakdown
  };
}

/**
 * Calcula os pontos dos extras. Não grava nada.
 */
function calculateExtrasPoints(
  betExtras,
  championshipResults,
  scoringRules
) {
  const rules = sanitizeScoringRules(scoringRules);
  const results = championshipResults || {};

  const breakdown = {
    topScorer: 0,
    bestAttack: 0,
    worstDefense: 0,
    upset: 0
  };

  if (
    rules.topScorer > 0 &&
    strMatch(betExtras?.topScorer, results.topScorer)
  ) {
    breakdown.topScorer = rules.topScorer;
  }

  if (
    rules.bestAttack > 0 &&
    strMatch(betExtras?.bestAttack, results.bestAttack)
  ) {
    breakdown.bestAttack = rules.bestAttack;
  }

  if (
    rules.worstDefense > 0 &&
    strMatch(betExtras?.worstDefense, results.worstDefense)
  ) {
    breakdown.worstDefense = rules.worstDefense;
  }

  if (
    rules.upset > 0 &&
    strMatch(betExtras?.upset, results.upset)
  ) {
    breakdown.upset = rules.upset;
  }

  const total = Object.values(breakdown).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );

  return {
    points: total,
    total,
    breakdown
  };
}


function sanitizeGroupQualificationRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  const allowed = new Set([
    'positionCorrect',
    'positionIncorrect',
    'teamQualified',
    'teamNotQualified'
  ]);

  return rawRules.map((rule, index) => ({
    index,
    points: Math.max(0, Number(rule?.points) || 0),
    conditions: [...new Set(
      Array.isArray(rule?.conditions)
        ? rule.conditions.filter(c => allowed.has(c))
        : []
    )]
  })).filter(rule => rule.conditions.length > 0);
}

function groupQualificationConditionMatches(condition, item) {
  switch (condition) {
    case 'positionCorrect':
      return item.predictedPosition === item.actualPosition;
    case 'positionIncorrect':
      return item.predictedPosition !== item.actualPosition;
    case 'teamQualified':
      return item.predictedQualified === true && item.actualQualified === true;
    case 'teamNotQualified':
      return item.predictedQualified === false && item.actualQualified === false;
    default:
      return false;
  }
}

/**
 * Pontuação do Extra "Classificação para o mata-mata".
 *
 * Cada equipe é avaliada separadamente:
 * - condições da mesma regra = E
 * - regras = OU / primeira regra satisfeita
 * Os pontos de equipes diferentes são somados.
 *
 * A classificação oficial é derivada somente das partidas finalizadas.
 */

/**
 * Determina o estado de encerramento de cada grupo de forma genérica.
 *
 * A configuração `legs` informa se o confronto é em turno único (1)
 * ou turno e returno (2). A quantidade esperada é derivada dos times
 * realmente cadastrados nas partidas da fase:
 *
 *   n * (n - 1) / 2 * legs
 *
 * A existência de partidas agendadas é usada como fonte dos times,
 * enquanto apenas partidas não-scheduled contam como iniciadas e
 * `finished` conta como encerrada.
 */
function getGroupCompletionStatus(allGroupMatches = [], championshipRules = {}) {
  const source = (allGroupMatches || []).filter(m =>
    String(m.phase || '').toLowerCase() === 'group'
  );
  const qualification = championshipRules?.groupQualification || {};
  const configuredTotalTeams = Math.floor(Number(qualification.totalTeams) || 0);
  const configuredGroupCount = Math.floor(Number(qualification.groupCount) || 0);
  const configuredTeamsPerGroup = configuredTotalTeams > 0 && configuredGroupCount > 0 && configuredTotalTeams % configuredGroupCount === 0
    ? configuredTotalTeams / configuredGroupCount
    : 0;
  const legs = Number(qualification.legs) === 2 ? 2 : 1;
  const byGroup = {};

  for (const m of source) {
    const group = String(m.group || '').trim();
    const teamA = String(m.teamA || '').trim();
    const teamB = String(m.teamB || '').trim();
    if (!group || !teamA || !teamB || teamA === teamB) continue;

    byGroup[group] ||= {
      group, teams: new Set(), pairs: new Map(), startedMatches: 0
    };

    const item = byGroup[group];
    item.teams.add(teamA);
    item.teams.add(teamB);

    const pair = [teamA, teamB].sort().join('|||');
    const pairData = item.pairs.get(pair) || { configured: 0, finished: 0 };
    pairData.configured++;
    if (!['scheduled', 'cancelled', 'postponed'].includes(String(m.status || '').toLowerCase())) {
      item.startedMatches++;
    }
    if (m.status === 'finished') pairData.finished++;
    item.pairs.set(pair, pairData);
  }

  return Object.values(byGroup).map(item => {
    // Quando o campeonato é liberado rodada a rodada, nem todos os times
    // precisam aparecer nos documentos já materializados. Se o ADM informou
    // uma estrutura válida, ela é a fonte de verdade para o tamanho do grupo.
    const observedTeamCount = item.teams.size;
    const teamCount = configuredTeamsPerGroup >= 2
      ? Math.max(configuredTeamsPerGroup, observedTeamCount)
      : observedTeamCount;
    const expectedMatches = getRoundRobinExpectedMatchCount(teamCount, legs);
    const expectedPairs = getRoundRobinExpectedMatchCount(teamCount, 1);

    const configuredMatches = [...item.pairs.values()]
      .reduce((sum, pair) => sum + pair.configured, 0);
    const finishedMatches = [...item.pairs.values()]
      .reduce((sum, pair) => sum + pair.finished, 0);

    const everyPairHasExpectedLegs =
      expectedPairs > 0 &&
      item.pairs.size === expectedPairs &&
      [...item.pairs.values()].every(pair => pair.configured >= legs);

    const everyPairFinished =
      everyPairHasExpectedLegs &&
      [...item.pairs.values()].every(pair => pair.finished >= legs);

    return {
      group: item.group,
      teamCount,
      legs,
      expectedMatches,
      configuredMatches,
      startedMatches: item.startedMatches,
      finishedMatches,
      started: item.startedMatches > 0,
      complete: everyPairFinished
    };
  });
}

function calculateGroupQualificationPoints(
  groupPredictions,
  groupMatches,
  scoringRules = {},
  championshipRules = {},
  isPartial = false,
  allGroupMatches = groupMatches
) {
  const rules = sanitizeGroupQualificationRules(
    scoringRules?.groupQualificationRules
  );

  // Sem fase de grupos não existe classificação prevista nem pontuação
  // de classificação, mesmo que regras antigas ainda estejam armazenadas.
  if (championshipRules?.hasGroupPhase !== true || championshipRules?.hasKnockoutPhase !== true) {
    return { points: 0, breakdown: [], byGroup: [] };
  }

  if (!rules.length || !Array.isArray(groupPredictions) || !groupPredictions.length) {
    return { points: 0, breakdown: [], byGroup: [] };
  }

  const qualificationConfig = championshipRules?.groupQualification || {};
  const configuredTotalTeams = Number(qualificationConfig.totalTeams || 0);
  const configuredGroupCount = Number(qualificationConfig.groupCount || 0);
  const configuredTotalQualified = Number(qualificationConfig.totalQualified || 0);
  const validQualificationConfig =
    configuredTotalTeams > 0 &&
    configuredGroupCount > 0 &&
    configuredTotalQualified > 0 &&
    configuredTotalTeams % configuredGroupCount === 0 &&
    configuredTotalQualified <= configuredTotalTeams;

  // Sem configuração não presumimos quem está/não está classificado.
  // Portanto as condições teamQualified/teamNotQualified não pontuam.
  if (!validQualificationConfig) {
    const hasQualificationStatusCondition = rules.some(rule =>
      rule.conditions.includes('teamQualified') ||
      rule.conditions.includes('teamNotQualified')
    );
    if (hasQualificationStatusCondition) {
      return { points: 0, breakdown: [], byGroup: [] };
    }
  }

  // `matches` = partidas que entram no cálculo do modo atual:
  //   Oficial -> finished
  //   Live    -> iniciadas e válidas (não scheduled/cancelled/postponed)
  //
  // `allGroupMatches` = TODAS as partidas da fase. Elas são a fonte de
  // verdade para descobrir todos os times/grupos, inclusive equipes que
  // ainda não jogaram. Isso é indispensável para a pontuação LIVE e OFICIAL.
  const matches = (groupMatches || []).filter(m => {
    const status = String(m.status || '').toLowerCase();
    const isValidStartedStatus =
      status !== 'scheduled' &&
      status !== 'cancelled' &&
      status !== 'postponed';

    return (
      String(m.phase || '').toLowerCase() === 'group' &&
      (!isPartial ? status === 'finished' : isValidStartedStatus)
    );
  });

  const sourceMatches = (allGroupMatches || groupMatches || []).filter(m =>
    String(m.phase || '').toLowerCase() === 'group'
  );

  const groupCompletion = getGroupCompletionStatus(
    sourceMatches,
    championshipRules
  );
  const completionByGroup = new Map(
    groupCompletion.map(item => [item.group, item])
  );
  const allGroupsComplete =
    groupCompletion.length > 0 &&
    groupCompletion.every(item => item.complete);

  const grouped = {};
  const teamRows = {};

  // Primeiro cadastra todos os times da fase, com estatísticas zeradas.
  for (const m of sourceMatches) {
    const group = String(m.group || '').trim();
    if (!group || !m.teamA || !m.teamB) continue;
    grouped[group] ||= [];
    if (!teamRows[group]) teamRows[group] = {};

    for (const t of [m.teamA, m.teamB]) {
      if (!teamRows[group][t]) {
        teamRows[group][t] = {
          name: t, pts: 0, gp: 0, gc: 0, sg: 0
        };
      }
    }
  }

  // Depois aplica somente os resultados válidos para o modo solicitado.
  for (const m of matches) {
    const group = String(m.group || '').trim();
    if (!group || !m.teamA || !m.teamB) continue;
    grouped[group] ||= [];

    const a = teamRows[group]?.[m.teamA];
    const b = teamRows[group]?.[m.teamB];
    if (!a || !b) continue;
    const sa = Number(m.scoreA), sb = Number(m.scoreB);
    if (!Number.isFinite(sa) || !Number.isFinite(sb)) continue;

    a.gp += sa; a.gc += sb; a.sg = a.gp - a.gc;
    b.gp += sb; b.gc += sa; b.sg = b.gp - b.gc;
    if (sa > sb) a.pts += 3;
    else if (sb > sa) b.pts += 3;
    else { a.pts += 1; b.pts += 1; }
  }

  const qualification = championshipRules?.groupQualification || {};
  const totalTeams = Number(qualification.totalTeams || 0);
  const groupCount = Number(qualification.groupCount || 0);
  const totalQualified = Number(qualification.totalQualified || 0);

  const groups = Object.keys(teamRows);
  const configurationIsValid =
    totalTeams > 0 &&
    groupCount > 0 &&
    totalQualified > 0 &&
    totalTeams % groupCount === 0 &&
    totalQualified <= totalTeams;

  const basePerGroup = configurationIsValid
    ? Math.floor(totalQualified / groupCount)
    : 0;
  const additionalCount = configurationIsValid
    ? totalQualified % groupCount
    : 0;
  const additionalPosition =
    additionalCount > 0 ? basePerGroup + 1 : null;

  /*
   * A classificação oficial é a mesma do groupController.
   * Reutilizamos a mesma função em vez de duplicar a regra.
   *
   * Observação importante: o groupController só consegue aplicar
   * confronto direto/saldo/gols quando há placares numéricos. Isso é
   * intencional: é a regra oficial da classificação.
   */
  const standingsMatches = matches.map(m => ({
    ...m,
    group: String(m.group || '').trim()
  }));

  // Pontuação usa apenas partidas válidas para o modo (LIVE/Oficial),
  // mas a classificação precisa conhecer todos os times da fase.
  const groupedResults = calculateGroupStandings(
    standingsMatches,
    sourceMatches
  );

  const rankedByGroup = {};
  Object.entries(groupedResults).forEach(([group, teams]) => {
    rankedByGroup[group] = teams;
  });

  const additionalCandidates = additionalPosition
    ? groups
        .map(g => rankedByGroup[g]?.[additionalPosition - 1])
        .filter(Boolean)
        .sort((a, b) => {
          if (b.pts !== a.pts) return b.pts - a.pts;
          if (b.sg !== a.sg) return b.sg - a.sg;
          if (b.gp !== a.gp) return b.gp - a.gp;
          return a.name.localeCompare(b.name);
        })
    : [];

  const additionalNames = new Set(
    additionalCandidates
      .slice(0, additionalCount)
      .map(t => t.name)
  );

  const qualified = {};
  for (const group of groups) {
    qualified[group] = new Set(
      (rankedByGroup[group] || [])
        .filter((team, idx) =>
          idx < basePerGroup ||
          (
            additionalPosition &&
            idx === additionalPosition - 1 &&
            additionalNames.has(team.name)
          )
        )
        .map(team => team.name)
    );
  }

  const breakdown = [];
  let total = 0;
  const byGroup = [];

  // Um grupo só pode gerar pontos depois que pelo menos uma partida
  // daquele grupo entrou no cálculo do modo atual.
  //
  // Isso evita a situação em que a tabela, ainda sem nenhum jogo,
  // possui todos os times zerados e acaba atribuindo pontos ao palpite
  // apenas por uma ordem alfabética/empate de critérios.
  const groupsWithPlayedMatches = new Set(
    matches
      .map(m => String(m.group || '').trim())
      .filter(Boolean)
  );

  for (const prediction of groupPredictions) {
    const group = String(prediction?.group || '').trim();
    const state = completionByGroup.get(group);

    if (!state?.started) continue;

    // Oficial: o grupo precisa estar completamente encerrado.
    // LIVE: a situação atual pode ser exibida/recalculada.
    if (!isPartial && !state.complete) continue;

    const ranked = rankedByGroup[group] || [];
    if (!ranked.length) continue;

    const actualPosition = new Map(ranked.map((team, idx) => [team.name, idx + 1]));
    // Vagas diretas tornam-se definitivas quando ESTE grupo termina.
    // Vagas adicionais entre grupos só são definitivas quando TODOS terminam.
    const actualQualified = new Set(
      ranked.slice(0, basePerGroup).map(team => team.name)
    );

    if (allGroupsComplete && additionalCount > 0) {
      for (const teamName of (qualified[group] || new Set())) {
        actualQualified.add(teamName);
      }
    }

    let groupPoints = 0;
    const predictedAdditional = new Set(
      Array.isArray(prediction.additionalQualifiedTeams)
        ? prediction.additionalQualifiedTeams.map(String)
        : []
    );

    for (const p of prediction.positions || []) {
      const team = String(p.team || '').trim();
      const item = {
        group,
        team,
        predictedPosition: Number(p.position),
        actualPosition: actualPosition.get(team) || null,
        predictedQualified:
          Number(p.position) <= basePerGroup ||
          (
            additionalCount > 0 &&
            predictedAdditional.has(team)
          ),
        actualQualified: actualQualified.has(team)
      };

      if (!item.actualPosition) continue;

      let matched = null;
      for (const rule of rules) {
        if (rule.conditions.every(c => groupQualificationConditionMatches(c, item))) {
          matched = rule;
          break;
        }
      }

      const pts = matched ? matched.points : 0;
      groupPoints += pts;
      breakdown.push({
        team: item.team,
        group,
        predictedPosition: item.predictedPosition,
        actualPosition: item.actualPosition,
        predictedQualified: item.predictedQualified,
        actualQualified: item.actualQualified,
        points: pts,
        matchedRuleIndex: matched ? matched.index : null
      });
    }

    total += groupPoints;
    byGroup.push({
      group,
      points: groupPoints,
      status: isPartial ? 'partial' : 'official',
      groupComplete: Boolean(state.complete),
      expectedMatches: Number(state.expectedMatches || 0),
      finishedMatches: Number(state.finishedMatches || 0)
    });
  }

  return {
    points: total,
    breakdown,
    byGroup,
    groupStatus: groupCompletion
  };
}

/**
 * Localiza as duas partidas de um confronto ida e volta.
 * A associação é feita pela etapa e pelo mesmo par de equipes,
 * independentemente de quem é mandante em cada jogo.
 */
function parseConfrontationDate(match) {
  const raw = String(match?.date || '').trim();
  const md = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const mt = String(match?.time || '00:00').match(/^(\d{1,2}):(\d{2})/);
  if (md) return Date.parse(`${md[3]}-${md[2]}-${md[1]}T${String(mt ? mt[1] : '0').padStart(2,'0')}:${mt ? mt[2] : '00'}:00Z`) || 0;
  return Date.parse(raw) || 0;
}

function getKnockoutConfrontationMatches(realMatch, matchMap, champRules) {
  if (!realMatch) return [];
  if (realMatch.phase !== 'knockout' && realMatch.phase !== 'mata-mata') return [];

  // A configuração do campeonato é a fonte de verdade. stageFormat é apenas
  // um campo materializado/derivado e não pode reativar ida/volta quando o ADM
  // configurou jogo único (nem alterar a regra específica da Final).
  const effectiveFormat = getEffectiveKnockoutFormat(champRules || {}, realMatch);

  if (effectiveFormat !== 'home_away') return [];

  const identity = getKnockoutConfrontationKey(realMatch);
  if (!identity) return [];

  return [...(matchMap instanceof Map ? matchMap.values() : [])]
    .filter(m => {
      if (!m || (m.phase !== 'knockout' && m.phase !== 'mata-mata')) return false;
      return sameKnockoutConfrontation(realMatch, m);
    })
    .sort((x, y) => {
      const lx = Number(x?.knockoutLeg);
      const ly = Number(y?.knockoutLeg);
      if (Number.isFinite(lx) && Number.isFinite(ly) && lx !== ly) return lx - ly;
      return parseConfrontationDate(x) - parseConfrontationDate(y) || Number(x.matchId) - Number(y.matchId);
    });
}

function resolveKnockoutConfrontationQualifier(realMatch, matchMap, champRules) {
  const legs = getKnockoutConfrontationMatches(realMatch, matchMap, champRules);
  const validation = validateHomeAwayLegs(legs, 2);
  if (!validation.valid) return null;
  if (!legs.every(m => m.status === 'finished')) return null;

  const pair = getCanonicalTeamPair(legs[0]);
  if (!pair) return null;
  const teamA = String(realMatch.teamA || '').trim().toLowerCase();
  const teamB = String(realMatch.teamB || '').trim().toLowerCase();
  if (!teamA || !teamB || teamA === teamB) return null;

  const manual = new Set();
  for (const leg of legs) {
    if (leg.qualifiedSideManuallySet !== true) continue;
    const q = leg.qualifiedSide === 'A' || leg.qualifiedSide === 'B' ? leg.qualifiedSide : null;
    if (!q) continue;
    const t = q === 'A' ? String(leg.teamA || '').trim().toLowerCase() : String(leg.teamB || '').trim().toLowerCase();
    if (t === teamA) manual.add('A');
    else if (t === teamB) manual.add('B');
    else return null;
  }
  if (manual.size !== 1 && manual.size !== 0) return null;
  if (manual.size === 1) return [...manual][0];

  const totalFor = (team) => legs.reduce((sum, m) => {
    const home = String(m.teamA || '').trim().toLowerCase();
    const away = String(m.teamB || '').trim().toLowerCase();
    if (home === team) return sum + Number(m.scoreA ?? 0);
    if (away === team) return sum + Number(m.scoreB ?? 0);
    return sum;
  }, 0);
  const totalA = totalFor(teamA);
  const totalB = totalFor(teamB);
  if (totalA !== totalB) return totalA > totalB ? 'A' : 'B';

  if (champRules.knockoutAwayGoals) {
    const awayGoalsFor = (team) => legs.reduce((sum, m) => {
      const awayTeam = String(m.teamB || '').trim().toLowerCase();
      return sum + (awayTeam === team ? Number(m.scoreB ?? 0) : 0);
    }, 0);
    const awayA = awayGoalsFor(teamA);
    const awayB = awayGoalsFor(teamB);
    if (awayA !== awayB) return awayA > awayB ? 'A' : 'B';
  }

  // Empate no agregado: pênaltis da última perna resolvem o confronto.
  const last = legs[legs.length - 1];
  if (last.penaltiesA != null && last.penaltiesB != null && Number(last.penaltiesA) !== Number(last.penaltiesB)) {
    const lastTeamA = String(last.teamA || '').trim().toLowerCase();
    const winnerTeam = Number(last.penaltiesA) > Number(last.penaltiesB)
      ? lastTeamA : String(last.teamB || '').trim().toLowerCase();
    if (winnerTeam === teamA) return 'A';
    if (winnerTeam === teamB) return 'B';
    return null;
  }

  // Se o empate persistir, somente uma decisão manual poderia resolvê-lo.
  return null;
}

/**
 * Calcula uma partida levando em conta, quando aplicável, o confronto ida/volta.
 * Mantém calculateMatchPoints puro para os consumidores de partida isolada.
 */
function calculateBetMatchPoints(betMatch, match, matchMap, scoringRules = DEFAULT_SCORING, championshipRules = DEFAULT_CHAMPIONSHIP_RULES, isPartial = false) {
  let betForCalculation = betMatch;
  let matchForCalculation = match;
  if (
    (match?.phase === 'knockout' || match?.phase === 'mata-mata') &&
    getEffectiveKnockoutFormat(championshipRules || {}, match) === 'home_away'
  ) {
    const legs = getKnockoutConfrontationMatches(match, matchMap, championshipRules);
    if (legs.length >= 2) {
      const firstLegId = Number(legs[0].matchId);
      const complete = legs.every(m => m.status === 'finished');
      betForCalculation = { ...betMatch };
      if (Number(match.matchId) !== firstLegId || !complete) betForCalculation.qualifier = null;
      if (complete && Number(match.matchId) === firstLegId) {
        const scenarioQualifier = match?.scenarioConfrontationQualifier === true &&
          (match.qualifiedSide === 'A' || match.qualifiedSide === 'B')
          ? match.qualifiedSide
          : null;
        const resolvedQualifier = scenarioQualifier || resolveKnockoutConfrontationQualifier(match, matchMap, championshipRules);
        matchForCalculation = { ...match, qualifiedSide: resolvedQualifier };
      }
    }
  }
  return calculateMatchPoints(betForCalculation, matchForCalculation, scoringRules, championshipRules, isPartial);
}

/**
 * Calcula a pontuação total de uma aposta em memória.
 *
 * Esta função é usada por endpoints de ranking/estatísticas e também por
 * simulações. Não salva nada no banco.
 */
function calculateBetTotal(
  bet,
  matchMap,
  settings = {},
  isPartial = false
) {
  const rules = sanitizeScoringRules(settings?.scoringRules);
  const champRules = sanitizeChampionshipRules(settings?.championshipRules);
  const champResults = settings?.championshipResults || {};
  const officialPodium = settings?.podium || [];

  let groupPoints = 0;
  let groupPhasePoints = 0;
  let knockoutPoints = 0;
  let knockoutMatchPoints = 0;
  let knockoutQualifierPoints = 0;
  let exactScorePoints = 0;

  for (const betMatch of bet?.groupMatches || []) {
    const match = matchMap?.get(String(betMatch.matchId));
    if (!match) continue;

    const result = calculateBetMatchPoints(
      betMatch,
      match,
      matchMap,
      rules,
      champRules,
      isPartial
    );

    groupPoints += result.points;
    if (Array.isArray(result.breakdown?.matchedConditions) &&
        result.breakdown.matchedConditions.includes('exactScore')) {
      exactScorePoints += Number(result.breakdown?.matchRulePoints || 0);
    } else {
      exactScorePoints += Number(result.breakdown?.exactScore || 0);
    }

    if (
      match.phase === 'group' ||
      match.phase === 'pontos_corridos'
    ) {
      groupPhasePoints += result.points;
    } else if (
      match.phase === 'knockout' ||
      match.phase === 'mata-mata'
    ) {
      const qualifierPoints = Number(result.breakdown?.qualifier || 0);
      const matchOnlyPoints = Math.max(0, Number(result.points || 0) - qualifierPoints);
      knockoutMatchPoints += matchOnlyPoints;
      knockoutQualifierPoints += qualifierPoints;
      knockoutPoints += Number(result.points || 0);
    }
  }

  const podiumResult = calculatePodiumPoints(
    bet?.podium || [],
    officialPodium,
    rules.podiumPoints || [],
    champRules.podiumSize
  );

  const extrasResult = calculateExtrasPoints(
    bet?.extras || {},
    champResults,
    rules
  );

  const groupQualificationResult = calculateGroupQualificationPoints(
    bet?.groupPredictions || [],
    [...(matchMap?.values?.() || [])],
    rules,
    champRules,
    isPartial,
    [...(matchMap?.values?.() || [])]
  );

  const bonusPoints = Number(bet?.bonusPoints) || 0;
  const totalPoints =
    groupPoints +
    podiumResult.points +
    extrasResult.points +
    groupQualificationResult.points +
    bonusPoints;

  return {
    totalPoints,
    groupPoints,
    groupPhasePoints,
    groupMatchPoints: groupPoints,
    groupQualificationPoints: groupQualificationResult.points,
    knockoutPoints,
    knockoutMatchPoints,
    knockoutQualifierPoints,
    exactScorePoints,
    podiumPoints: podiumResult.points,
    extrasPoints: extrasResult.points,
    groupQualificationPoints: groupQualificationResult.points,
    groupQualificationBreakdown: groupQualificationResult.breakdown,
    bonusPoints,
    podiumBreakdown: podiumResult.breakdown,
    extrasBreakdown: extrasResult.breakdown,
    lastUpdate: bet?.lastUpdate
  };
}

/**
 * Recalcula a pontuação persistida de todos os usuários da liga.
 *
 * Importante: esta função é a única responsável por GRAVAR a pontuação.
 * A regra de cálculo em si fica nas funções puras acima.
 */
async function recalculateAllPoints(
  leagueId = 'default',
  externalSession = null
) {
  const normalizedLeagueId = String(leagueId).trim();
  const shouldManageSession = !externalSession;
  const session = externalSession || await mongoose.startSession();

  if (shouldManageSession) {
    session.startTransaction();
  }

  try {
    let settings = await Settings.findById(normalizedLeagueId)
      .lean()
      .session(session);

    if (!settings) {
      console.warn(
        `⚠️ Settings não encontrados para liga ${normalizedLeagueId}. Usando defaults.`
      );

      settings = {
        _id: normalizedLeagueId,
        leagueId: normalizedLeagueId,
        scoringRules: DEFAULT_SCORING,
        championshipRules: DEFAULT_CHAMPIONSHIP_RULES,
        championshipResults: {},
        podium: []
      };
    }

    const scoringRules = sanitizeScoringRules(settings.scoringRules);
    const champRules = sanitizeChampionshipRules(settings.championshipRules);
    const champResults = settings.championshipResults || {};
    const officialPodium = settings.podium || [];

    const finishedMatches = await Match.find({
      leagueId: normalizedLeagueId,
      status: 'finished'
    })
      .lean()
      .session(session);

    const matchesMap = new Map(
      finishedMatches.map(match => [String(match.matchId), match])
    );

    const bets = await Bet.find({
      leagueId: normalizedLeagueId
    }).session(session);

    // Carregado uma única vez: serve para determinar dinamicamente a
    // estrutura/encerramento de cada grupo sem fazer uma consulta por aposta.
    const allGroupMatches = await Match.find({
      leagueId: normalizedLeagueId,
      phase: 'group'
    })
      .lean()
      .session(session);

    let updated = 0;

    for (const bet of bets) {
      const oldTotalPoints = Number(bet.totalPoints) || 0;
      const podiumSize = champRules.podiumSize;

      // ------------------------------------------------------------
      // APOSTA NÃO SUBMETIDA
      // ------------------------------------------------------------
      if (!bet.hasSubmitted) {
        for (const groupMatch of bet.groupMatches || []) {
          groupMatch.points = 0;
          groupMatch.pointsBreakdown = {
            exactScore: 0,
            scoreTeamA: 0,
            scoreTeamB: 0,
            winner: 0,
            qualifier: 0
          };
        }

        bet.podiumBreakdown = new Array(podiumSize).fill(0);
        bet.extrasBreakdown = {
          topScorer: 0,
          bestAttack: 0,
          worstDefense: 0,
          upset: 0,
          groupQualification: 0
        };
        bet.groupPredictionPoints = 0;
        bet.groupPredictionBreakdown = [];

        bet.lastUpdate = new Date();
        bet.recalculateTotals();

        bet.markModified('groupMatches');
        bet.markModified('podiumBreakdown');
        bet.markModified('extrasBreakdown');

        await bet.save({ session });

        if (oldTotalPoints !== Number(bet.totalPoints) || oldTotalPoints !== 0) {
          updated++;
        }

        continue;
      }

      // ------------------------------------------------------------
      // PARTIDAS
      // ------------------------------------------------------------
      for (const groupMatch of bet.groupMatches || []) {
        const match = matchesMap.get(String(groupMatch.matchId));

        const result = calculateBetMatchPoints(
          groupMatch,
          match,
          matchesMap,
          scoringRules,
          champRules,
          false
        );

        groupMatch.points = result.points;
        groupMatch.pointsBreakdown = result.breakdown;
      }

      // ------------------------------------------------------------
      // PÓDIO
      // ------------------------------------------------------------
      const podiumResult = calculatePodiumPoints(
        Array.isArray(bet.podium) ? bet.podium : [],
        officialPodium,
        scoringRules.podiumPoints,
        podiumSize
      );

      bet.podiumBreakdown = podiumResult.breakdown;

      // ------------------------------------------------------------
      // EXTRAS
      // ------------------------------------------------------------
      const extrasResult = calculateExtrasPoints(
        bet.extras || {},
        champResults,
        scoringRules
      );

      bet.extrasBreakdown = {
        ...extrasResult.breakdown,
        groupQualification: 0
      };

      // ------------------------------------------------------------
      // CLASSIFICAÇÃO PARA O MATA-MATA
      // ------------------------------------------------------------
      const groupQualificationResult = calculateGroupQualificationPoints(
        bet.groupPredictions || [],
        finishedMatches.filter(m =>
          String(m.phase || '').toLowerCase() === 'group'
        ),
        scoringRules,
        champRules,
        false,
        allGroupMatches
      );
      bet.groupPredictionPoints = groupQualificationResult.points;
      bet.groupPredictionBreakdown = groupQualificationResult.byGroup;
      bet.extrasBreakdown.groupQualification = groupQualificationResult.points;

      // ------------------------------------------------------------
      // TOTAIS
      // ------------------------------------------------------------
      bet.lastUpdate = new Date();
      bet.recalculateTotals();

      bet.markModified('groupMatches');
      bet.markModified('podiumBreakdown');
      bet.markModified('extrasBreakdown');
      bet.markModified('groupPredictions');
      bet.markModified('groupPredictionBreakdown');

      await bet.save({ session });

      if (oldTotalPoints !== Number(bet.totalPoints)) {
        updated++;
      }
    }

    if (shouldManageSession) {
      await session.commitTransaction();
    }

    console.log(
      `✅ Recálculo concluído! ${updated} apostas modificadas na liga ${normalizedLeagueId}.`
    );

    return {
      ok: true,
      updated
    };
  } catch (error) {
    if (shouldManageSession) {
      await session.abortTransaction();
    }

    console.error('❌ Erro no recálculo de pontos:', error);
    throw error;
  } finally {
    if (shouldManageSession) {
      await session.endSession();
    }
  }
}

async function getPodium(leagueId) {
  if (!leagueId) return [];

  const doc = await Settings.findById(String(leagueId).trim()).lean();
  return doc?.podium || [];
}

async function normalizePodiumInput(leagueId, podiumInput) {
  if (!leagueId) {
    throw new Error('leagueId é obrigatório');
  }

  const id = String(leagueId).trim();
  const settings = await Settings.findById(id).lean();
  const podiumSize = sanitizeChampionshipRules(
    settings?.championshipRules
  ).podiumSize;

  let podiumArray = [];

  if (Array.isArray(podiumInput)) {
    podiumArray = podiumInput
      .map(value => String(value).trim())
      .filter(value => value.length > 0);
  } else if (
    typeof podiumInput === 'object' &&
    podiumInput !== null
  ) {
    const positionalKeys = [
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
      'sixth',
      'seventh',
      'eighth'
    ];

    for (let i = 0; i < podiumSize; i++) {
      const value =
        podiumInput[String(i)] ??
        podiumInput[positionalKeys[i]];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      ) {
        podiumArray.push(String(value).trim());
      }
    }
  } else if (typeof podiumInput === 'string') {
    const value = podiumInput.trim();
    if (value) podiumArray = [value];
  }

  if (podiumArray.length > podiumSize) {
    podiumArray = podiumArray.slice(0, podiumSize);
  }

  return {
    podiumArray,
    podiumSize
  };
}

async function setPodium(leagueId, podiumInput) {
  if (!leagueId) {
    throw new Error('leagueId é obrigatório para definir o pódio');
  }

  const { podiumArray, podiumSize } = await normalizePodiumInput(
    leagueId,
    podiumInput
  );

  if (podiumArray.length > podiumSize) {
    throw new Error(
      `Pódio excede o limite de ${podiumSize} times permitidos.`
    );
  }

  const id = String(leagueId).trim();
  let settings = await Settings.findById(id);

  if (!settings) {
    settings = new Settings({
      _id: id,
      leagueId: id,
      scoringRules: DEFAULT_SCORING,
      championshipRules: DEFAULT_CHAMPIONSHIP_RULES
    });
  }

  settings.podium = podiumArray;

  if (!Array.isArray(settings.historyEvents)) {
    settings.historyEvents = [];
  }

  settings.historyEvents.push({
    type: 'podium_defined',
    key: null,
    value: [...podiumArray],
    at: new Date()
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await settings.save({ session });

    const result = await recalculateAllPoints(id, session);

    await session.commitTransaction();

    return {
      ok: true,
      updated: result.updated,
      podium: podiumArray
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function resetPodium(leagueId) {
  if (!leagueId) {
    return {
      ok: false,
      message: 'leagueId ausente'
    };
  }

  const id = String(leagueId).trim();
  const settings = await Settings.findById(id);

  if (!settings) {
    throw new Error(
      `Configurações não encontradas para a liga ${id}`
    );
  }

  settings.podium = [];

  if (!Array.isArray(settings.historyEvents)) {
    settings.historyEvents = [];
  }

  settings.historyEvents.push({
    type: 'podium_reset',
    key: null,
    value: [],
    at: new Date()
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await settings.save({ session });

    const result = await recalculateAllPoints(id, session);

    await session.commitTransaction();

    return {
      ok: true,
      updated: result.updated
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  toBooleanFlag,
  getRoundRobinExpectedMatchCount,
  isPowerOfTwo,
  DEFAULT_SCORING,
  DEFAULT_SCORING_RULES,
  DEFAULT_CHAMPIONSHIP_RULES,
  MATCH_RULE_CONDITIONS,
  sanitizeMatchRules,
  sanitizeScoringRules,
  sanitizeChampionshipRules,
  sanitizeGroupQualificationRules,
  calculateGroupQualificationPoints,
  getGroupCompletionStatus,
  getScoringRules,
  getChampionshipRules,
  getMatchReferenceScore,
  getMatchReferenceQualifier,
  getMaxPointsPerMatch,
  calculateMatchPoints,
  calculateBetMatchPoints,
  getKnockoutConfrontationMatches,
  resolveKnockoutConfrontationQualifier,
  calculatePodiumPoints,
  calculateExtrasPoints,
  calculateBetTotal,
  recalculateAllPoints,
  getPodium,
  setPodium,
  resetPodium
};
