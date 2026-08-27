// frontendScoring.js
// Espelha as regras de referência do services/pointsService.js.
// O frontend usa este módulo apenas para exibição/simulações locais;
// a pontuação oficial continua sendo calculada pelo backend.

export const DEFAULT_SCORING = Object.freeze({
  exactScore: 5,
  scoreTeamA: 1,
  scoreTeamB: 1,
  winner: 2,
  matchExtras: Object.freeze({ qualifier: 3 }),
  podiumPoints: [20, 15, 10, 5],
  topScorer: 10,
  bestAttack: 10,
  worstDefense: 10,
  upset: 15
});

export const DEFAULT_CHAMPIONSHIP_RULES = Object.freeze({
  podiumSize: 4,
  drawIncludesExtraTime: false,
  winnerFromScore: true
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getScoringRules(settings = {}) {
  return { ...DEFAULT_SCORING, ...(settings?.scoringRules || {}) };
}

export function getMatchExtrasRules(settings = {}) {
  const scoring = settings?.scoringRules || {};
  const configured = scoring.matchExtras?.qualifier;
  return {
    qualifier: Number.isFinite(Number(configured))
      ? Math.max(0, Number(configured))
      : 0
  };
}

export function getChampionshipRules(settings = {}) {
  return { ...DEFAULT_CHAMPIONSHIP_RULES, ...(settings?.championshipRules || {}) };
}

function scoresAreEnabled(rules = {}) {
  return (Number(rules.exactScore) || 0) > 0 ||
    (Number(rules.scoreTeamA) || 0) > 0 ||
    (Number(rules.scoreTeamB) || 0) > 0;
}

function winnerFromScores(scoreA, scoreB) {
  const a = num(scoreA);
  const b = num(scoreB);
  if (a == null || b == null) return null;
  return a > b ? 'A' : b > a ? 'B' : 'draw';
}

export function getEffectiveBetWinner(betMatch, settings = {}) {
  const rules = getScoringRules(settings);
  const champRules = getChampionshipRules(settings);
  const storedWinner = betMatch?.winner ?? betMatch?.choice ?? null;
  const customRules = Array.isArray(rules.matchRules) && rules.matchRules.length > 0;

  if (customRules) {
    // Em regras personalizadas, uma escolha explícita de resultado tem
    // prioridade. Se ela não existir, o placar pode servir como fallback
    // para condições como gols do vencedor/perdedor.
    if (storedWinner) return storedWinner;
    return winnerFromScores(
      betMatch?.scoreA ?? betMatch?.betScoreA,
      betMatch?.scoreB ?? betMatch?.betScoreB
    );
  }

  if (!scoresAreEnabled(rules) || champRules.winnerFromScore === false) {
    return storedWinner;
  }

  return winnerFromScores(betMatch?.scoreA ?? betMatch?.betScoreA, betMatch?.scoreB ?? betMatch?.betScoreB);
}

export function isKnockoutMatch(match) {
  if (!match) return false;
  const phase = String(match.phase ?? '').trim().toLowerCase();
  const stage = String(match.stage ?? '').trim().toLowerCase();

  // A fase explícita é a fonte principal. 'round 24', 'round 5', etc.
  // são rodadas da fase de grupos e NÃO significam mata-mata.
  if (phase === 'knockout' || phase === 'mata-mata' || phase.includes('knockout') || phase.includes('mata')) {
    return true;
  }
  if (phase === 'group' || phase === 'groups' || phase === 'grupo' || phase === 'grupos') {
    return false;
  }

  // Só reconhece nomes explícitos de fases eliminatórias no stage.
  if (/quarter|quartas|semi|semifinal|final|playoff|knockout/.test(stage)) return true;
  if (/round\s*(of\s*)?(16|8|4|2)\b/.test(stage)) return true;

  return false;
}

export function getReferenceScore(match, settings = {}, isPartial = false) {
  if (!match) return { scoreA: null, scoreB: null, winner: null };

  const liveStatuses = [
    '1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet',
    'prorrogacao', 'penaltis', 'in_progress', 'live'
  ];
  const isLive = liveStatuses.includes(match.status);
  const finished = match.status === 'finished' || match.status === 'FT';
  const simulated = Boolean(match.isSimulated);

  // No cálculo parcial, uma partida ao vivo é tratada como se terminasse
  // exatamente neste instante: sempre usamos o placar atual.
  if (isPartial && isLive) {
    const scoreA = num(match.scoreA);
    const scoreB = num(match.scoreB);
    const winner = scoreA != null && scoreB != null
      ? (scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw')
      : null;
    return { scoreA, scoreB, winner };
  }

  if (!finished && !simulated) {
    return { scoreA: null, scoreB: null, winner: null };
  }

  const rules = getChampionshipRules(settings);
  const useFinal = Boolean(rules.drawIncludesExtraTime ?? false);

  const scoreA = useFinal
    ? num(match.scoreA)
    : num(match.regularTimeScoreA ?? match.scoreA);

  const scoreB = useFinal
    ? num(match.scoreB)
    : num(match.regularTimeScoreB ?? match.scoreB);

  let winner = null;
  if (scoreA != null && scoreB != null) {
    winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw';
  }

  return { scoreA, scoreB, winner };
}

export function getReferenceQualifier(match, settings = {}, isPartial = false) {
  if (!isKnockoutMatch(match)) return null;

  const finished = match?.status === 'finished';

  // Igual ao backend: em partida oficial finalizada, qualifiedSide é a
  // fonte de verdade, inclusive quando foi definido manualmente pelo admin.
  if (finished && (match.qualifiedSide === 'A' || match.qualifiedSide === 'B')) {
    return match.qualifiedSide;
  }

  const ref = getReferenceScore(match, settings, isPartial);
  const pA = num(match?.penaltiesA);
  const pB = num(match?.penaltiesB);

  if (pA != null && pB != null && pA !== pB) {
    return pA > pB ? 'A' : 'B';
  }

  if (ref.scoreA != null && ref.scoreB != null && ref.scoreA !== ref.scoreB) {
    return ref.scoreA > ref.scoreB ? 'A' : 'B';
  }

  return null;
}


function getMatchRules(settings = {}, match = null) {
  const rules = getScoringRules(settings);
  if (!Array.isArray(rules.matchRules)) return [];

  return rules.matchRules
    .filter(rule => Array.isArray(rule?.conditions) && rule.conditions.length)
    .map(rule => ({
      points: Math.max(0, Number(rule.points) || 0),
      conditions: [...new Set(rule.conditions)].filter(condition =>
        [
          'exactScore',
          'result',
          'scoreTeamA',
          'scoreTeamB',
          'scoreWinner',
          'scoreLoser',
          'totalGoals',
          'goalDifference',
          'qualifier'
        ].includes(condition)
      )
    }))
    // NÃO remover "qualifier" em fase de grupos.
    // Se a regra for "Resultado E Classificado", ela precisa continuar
    // contendo as duas condições. O evaluator fará "Classificado" = false
    // porque a partida não é mata-mata. Remover a condição transformaria
    // incorretamente "A E B" em apenas "A".
    .filter(rule => rule.points > 0 && rule.conditions.length > 0);
}

function evaluateMatchRuleCondition(
  condition,
  betMatch,
  ref,
  referenceQualifier,
  effectiveBetWinner
) {
  const betA = num(betMatch?.scoreA ?? betMatch?.betScoreA);
  const betB = num(betMatch?.scoreB ?? betMatch?.betScoreB);
  const validA = betA != null;
  const validB = betB != null;

  switch (condition) {
    case 'exactScore':
      return validA && validB &&
        betA === Number(ref.scoreA) &&
        betB === Number(ref.scoreB);

    case 'result':
      return Boolean(effectiveBetWinner) &&
        effectiveBetWinner === ref.winner;

    case 'scoreTeamA':
      return validA && betA === Number(ref.scoreA);

    case 'scoreTeamB':
      return validB && betB === Number(ref.scoreB);

    case 'scoreWinner': {
      // Independente do resultado previsto: o "vencedor" é definido pelo
      // resultado REAL e comparamos somente os gols previstos desse lado.
      if (ref.winner !== 'A' && ref.winner !== 'B') return false;
      const predicted = ref.winner === 'A' ? betA : betB;
      const actual = ref.winner === 'A' ? Number(ref.scoreA) : Number(ref.scoreB);
      return Number.isFinite(predicted) && predicted === actual;
    }

    case 'scoreLoser': {
      // Independente do resultado previsto: o "perdedor" é definido pelo
      // resultado REAL e comparamos somente os gols previstos desse lado.
      if (ref.winner !== 'A' && ref.winner !== 'B') return false;
      const predicted = ref.winner === 'A' ? betB : betA;
      const actual = ref.winner === 'A' ? Number(ref.scoreB) : Number(ref.scoreA);
      return Number.isFinite(predicted) && predicted === actual;
    }

    case 'totalGoals':
      return validA && validB &&
        betA + betB === Number(ref.scoreA) + Number(ref.scoreB);

    case 'goalDifference':
      return validA && validB &&
        Math.abs(betA - betB) ===
        Math.abs(Number(ref.scoreA) - Number(ref.scoreB));


    default:
      return false;
  }
}

export function calculateMatchPoints(betMatch, match, settings = {}, isPartial = false) {
  const rules = getScoringRules(settings);
  const knockout = isKnockoutMatch(match);

  const breakdown = {
    exactScore: 0,
    scoreTeamA: 0,
    scoreTeamB: 0,
    winner: 0,
    qualifier: 0,
    matchRuleIndex: null,
    matchRulePoints: 0,
    matchedConditions: []
  };

  if (!betMatch || !match) return { points: 0, breakdown };

  const finished = match.status === 'finished';
  const simulated = Boolean(match.isSimulated);
  const canCalculate = isPartial
    ? (match.status !== 'scheduled' || simulated || finished)
    : (finished || simulated);

  if (!canCalculate) return { points: 0, breakdown };

  const ref = getReferenceScore(match, settings, isPartial);
  if (ref.scoreA == null || ref.scoreB == null) {
    return { points: 0, breakdown };
  }

  const referenceQualifier = knockout
    ? getReferenceQualifier(match, settings, isPartial)
    : null;

  const betWinner = getEffectiveBetWinner(betMatch, settings);
  const knockout = isKnockoutMatch(match);
  const matchRules = getMatchRules(settings, match)
    .map(rule => ({
      ...rule,
      conditions: (rule.conditions || []).filter(c => c !== 'qualifier')
    }))
    .filter(rule => rule.conditions.length > 0);

  const matchExtras = getMatchExtrasRules(settings);
  if (knockout && matchExtras.qualifier > 0 && betMatch.qualifier && referenceQualifier &&
      String(betMatch.qualifier) === String(referenceQualifier)) {
    breakdown.qualifier = matchExtras.qualifier;
  }

  if (matchRules.length > 0) {
    for (let index = 0; index < matchRules.length; index++) {
      const rule = matchRules[index];
      const satisfied = rule.conditions.every(condition =>
        evaluateMatchRuleCondition(
          condition,
          betMatch,
          ref,
          referenceQualifier,
          betWinner
        )
      );

      if (!satisfied) continue;

      breakdown.matchRuleIndex = index;
      breakdown.matchRulePoints = rule.points;
      breakdown.matchedConditions = [...rule.conditions];

      return {
        points: rule.points + Number(breakdown.qualifier || 0),
        breakdown,
        matchedRule: {
          index,
          points: rule.points,
          conditions: [...rule.conditions]
        }
      };
    }

    return { points: Number(breakdown.qualifier || 0), breakdown };
  }

  const betA = num(betMatch.scoreA ?? betMatch.betScoreA);
  const betB = num(betMatch.scoreB ?? betMatch.betScoreB);
  const exactHit =
    betA != null && betB != null &&
    betA === ref.scoreA && betB === ref.scoreB;

  // Todas as categorias configuradas são independentes.
  // Não existe mais modo dependent/independent no campeonato.
  if (exactHit && rules.exactScore > 0) {
    breakdown.exactScore = Number(rules.exactScore) || 0;
  }

  if (rules.scoreTeamA > 0 && betA != null && betA === ref.scoreA) {
    breakdown.scoreTeamA = Number(rules.scoreTeamA) || 0;
  }

  if (rules.scoreTeamB > 0 && betB != null && betB === ref.scoreB) {
    breakdown.scoreTeamB = Number(rules.scoreTeamB) || 0;
  }

  if (rules.winner > 0 && betWinner && ref.winner && betWinner === ref.winner) {
    breakdown.winner = Number(rules.winner) || 0;
  }

  const matchExtras = getMatchExtrasRules(settings);

  if (knockout && matchExtras.qualifier > 0 && betMatch.qualifier && referenceQualifier &&
      String(betMatch.qualifier) === String(referenceQualifier)) {
    breakdown.qualifier = matchExtras.qualifier;
  }

  const points =
    Number(breakdown.exactScore) +
    Number(breakdown.scoreTeamA) +
    Number(breakdown.scoreTeamB) +
    Number(breakdown.winner) +
    Number(breakdown.qualifier);

  return { points, breakdown };
}

export function getMatchPointStatus(betMatch, match, settings = {}, isPartial = false) {
  const result = calculateMatchPoints(betMatch, match, settings, isPartial);
  const matchRules = getMatchRules(settings, match)
    .map(rule => ({
      ...rule,
      conditions: (rule.conditions || []).filter(c => c !== 'qualifier')
    }))
    .filter(rule => rule.conditions.length > 0);

  if (matchRules.length > 0) {
    const matchExtraQualifier = knockout
      ? getMatchExtrasRules(settings).qualifier
      : 0;
    const maxMatchRulePoints = Math.max(...matchRules.map(rule => Number(rule.points) || 0), 0);
    const maxPoints = maxMatchRulePoints + matchExtraQualifier;
    let category = 'wrong';
    if (result.points > 0 && result.points === maxPoints) category = 'full';
    else if (result.points > 0) category = 'partial';

    const activeCategories = [...(result.breakdown?.matchedConditions || [])];
    if (matchExtraQualifier > 0 && result.breakdown?.qualifier > 0) {
      activeCategories.push('qualifier');
    }

    return {
      ...result,
      category,
      maxPoints,
      activeCategories
    };
  }

  const rules = getScoringRules(settings);
  const knockout = isKnockoutMatch(match);

  const active = [];
  if (rules.exactScore > 0) active.push('exactScore');
  if (rules.scoreTeamA > 0) active.push('scoreTeamA');
  if (rules.scoreTeamB > 0) active.push('scoreTeamB');
  if (rules.winner > 0) active.push('winner');

  const matchExtraQualifier = knockout
    ? getMatchExtrasRules(settings).qualifier
    : 0;
  if (matchExtraQualifier > 0) active.push('qualifier');

  const maxPoints = active.reduce((sum, key) => {
    if (key === 'qualifier') return sum + matchExtraQualifier;
    return sum + (Number(rules[key]) || 0);
  }, 0);
  const points = result.points;

  let category = 'wrong';
  if (maxPoints > 0 && points === maxPoints) category = 'full';
  else if (points > 0) category = 'partial';

  return { ...result, category, maxPoints, activeCategories: active };
}

export function getMaxPointsPerMatch(settings = {}, match = null) {
  const rules = getScoringRules(settings);
  const knockout = isKnockoutMatch(match);
  const matchRules = getMatchRules(settings, match)
    .map(rule => ({
      ...rule,
      conditions: (rule.conditions || []).filter(c => c !== 'qualifier')
    }))
    .filter(rule => rule.conditions.length > 0);

  const matchExtraQualifier = knockout
    ? getMatchExtrasRules(settings).qualifier
    : 0;

  if (matchRules.length > 0) {
    return Math.max(...matchRules.map(rule => Number(rule.points) || 0), 0)
      + matchExtraQualifier;
  }

  return (
    (Number(rules.exactScore) || 0) +
    (Number(rules.scoreTeamA) || 0) +
    (Number(rules.scoreTeamB) || 0) +
    (Number(rules.winner) || 0) +
    matchExtraQualifier
  );
}
