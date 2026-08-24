const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');

// ================================================================
// CONFIGURAÇÕES / DEFAULTS
// ================================================================

const DEFAULT_SCORING = Object.freeze({
  scoringMode: 'independent',
  exactScore: 5,
  scoreTeamA: 1,
  scoreTeamB: 1,
  winner: 2,
  qualifier: 3,
  topScorer: 10,
  bestAttack: 10,
  worstDefense: 10,
  upset: 15,
  podiumPoints: [20, 15, 10, 5]
});

const DEFAULT_CHAMPIONSHIP_RULES = Object.freeze({
  drawIncludesExtraTime: false,
  winnerFromScore: true,
  podiumSize: 4
});

/**
 * Compatibilidade com consumidores que usam este nome.
 * Mantemos uma cópia simples para evitar que alguém altere o default global.
 */
const DEFAULT_SCORING_RULES = DEFAULT_SCORING;

function strMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function sanitizeScoringRules(rawRules) {
  const rules = {
    ...DEFAULT_SCORING,
    ...(rawRules || {})
  };

  rules.scoringMode = rules.scoringMode === 'dependent'
    ? 'dependent'
    : 'independent';

  const numericKeys = [
    'exactScore',
    'scoreTeamA',
    'scoreTeamB',
    'winner',
    'qualifier',
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
  } else {
    rules.podiumPoints = rules.podiumPoints.map(value => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(0, number) : 0;
    });
  }

  return rules;
}

function sanitizeChampionshipRules(rawRules) {
  const rules = {
    ...DEFAULT_CHAMPIONSHIP_RULES,
    ...(rawRules || {})
  };

  rules.drawIncludesExtraTime = Boolean(rules.drawIncludesExtraTime);

  const podiumSize = Number(rules.podiumSize);
  rules.podiumSize = Number.isFinite(podiumSize)
    ? Math.max(0, Math.floor(podiumSize))
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
function getMaxPointsPerMatch(
  scoringRules = DEFAULT_SCORING,
  championshipRules = DEFAULT_CHAMPIONSHIP_RULES,
  phase = 'knockout'
) {
  const rules = sanitizeScoringRules(scoringRules);
  const champRules = sanitizeChampionshipRules(championshipRules);

  // O classificado só existe no mata-mata.
  const isKnockout = phase === 'knockout';

  void champRules;

  if (rules.scoringMode === 'dependent') {
    return rules.exactScore + (isKnockout ? rules.qualifier : 0);
  }

  return (
    rules.exactScore +
    rules.scoreTeamA +
    rules.scoreTeamB +
    rules.winner +
    (isKnockout ? rules.qualifier : 0)
  );
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
  const winnerFromScore = champRules.winnerFromScore !== false &&
    (rules.exactScore > 0 || rules.scoreTeamA > 0 || rules.scoreTeamB > 0);

  const effectiveBetWinner = winnerFromScore && validBetA && validBetB
    ? (betA > betB ? 'A' : betB > betA ? 'B' : 'draw')
    : betMatch.winner;

  if (rules.scoringMode === 'dependent') {
    // Modo dependente:
    // - se acertou o placar exato, pontua o placar exato;
    // - neste caso, gols A, gols B e vencedor NÃO pontuam;
    // - o classificado continua independente e pode pontuar.
    if (rules.exactScore > 0 && isExact) {
      breakdown.exactScore = rules.exactScore;
    } else {
      if (
        rules.scoreTeamA > 0 &&
        validBetA &&
        betA === Number(refA)
      ) {
        breakdown.scoreTeamA = rules.scoreTeamA;
      }

      if (
        rules.scoreTeamB > 0 &&
        validBetB &&
        betB === Number(refB)
      ) {
        breakdown.scoreTeamB = rules.scoreTeamB;
      }

      if (
        rules.winner > 0 &&
        effectiveBetWinner &&
        effectiveBetWinner === refWinner
      ) {
        breakdown.winner = rules.winner;
      }
    }
  } else {
    // Modo independente: todos os acertos aplicáveis acumulam.
    if (rules.exactScore > 0 && isExact) {
      breakdown.exactScore = rules.exactScore;
    }

    if (
      rules.scoreTeamA > 0 &&
      validBetA &&
      betA === Number(refA)
    ) {
      breakdown.scoreTeamA = rules.scoreTeamA;
    }

    if (
      rules.scoreTeamB > 0 &&
      validBetB &&
      betB === Number(refB)
    ) {
      breakdown.scoreTeamB = rules.scoreTeamB;
    }

    if (
      rules.winner > 0 &&
      effectiveBetWinner &&
      effectiveBetWinner === refWinner
    ) {
      breakdown.winner = rules.winner;
    }
  }

  // O classificado é sempre independente do modo de pontuação.
  if (
    rules.qualifier > 0 &&
    refQualifier &&
    betMatch.qualifier &&
    betMatch.qualifier === refQualifier
  ) {
    breakdown.qualifier = rules.qualifier;
  }

  const points =
    Number(breakdown.exactScore) +
    Number(breakdown.scoreTeamA) +
    Number(breakdown.scoreTeamB) +
    Number(breakdown.winner) +
    Number(breakdown.qualifier);

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

  for (const betMatch of bet?.groupMatches || []) {
    const match = matchMap?.get(String(betMatch.matchId));
    if (!match) continue;

    const result = calculateMatchPoints(
      betMatch,
      match,
      rules,
      champRules,
      isPartial
    );

    groupPoints += result.points;

    if (
      match.phase === 'group' ||
      match.phase === 'pontos_corridos'
    ) {
      groupPhasePoints += result.points;
    } else {
      knockoutPoints += result.points;
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

  const bonusPoints = Number(bet?.bonusPoints) || 0;
  const totalPoints =
    groupPoints +
    podiumResult.points +
    extrasResult.points +
    bonusPoints;

  return {
    totalPoints,
    groupPoints,
    groupPhasePoints,
    knockoutPoints,
    podiumPoints: podiumResult.points,
    extrasPoints: extrasResult.points,
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
          upset: 0
        };

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

        const result = calculateMatchPoints(
          groupMatch,
          match,
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

      bet.extrasBreakdown = extrasResult.breakdown;

      // ------------------------------------------------------------
      // TOTAIS
      // ------------------------------------------------------------
      bet.lastUpdate = new Date();
      bet.recalculateTotals();

      bet.markModified('groupMatches');
      bet.markModified('podiumBreakdown');
      bet.markModified('extrasBreakdown');

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
  DEFAULT_SCORING,
  DEFAULT_SCORING_RULES,
  DEFAULT_CHAMPIONSHIP_RULES,
  sanitizeScoringRules,
  sanitizeChampionshipRules,
  getScoringRules,
  getChampionshipRules,
  getMatchReferenceScore,
  getMatchReferenceQualifier,
  getMaxPointsPerMatch,
  calculateMatchPoints,
  calculatePodiumPoints,
  calculateExtrasPoints,
  calculateBetTotal,
  recalculateAllPoints,
  getPodium,
  setPodium,
  resetPodium
};
