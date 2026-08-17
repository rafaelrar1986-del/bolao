const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');

// Fallbacks de segurança
const DEFAULT_SCORING = {
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
};

const DEFAULT_CHAMPIONSHIP_RULES = {
  drawIncludesExtraTime: false,
  podiumSize: 4
};

function strMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function sanitizeScoringRules(rawRules) {
  const rules = { ...DEFAULT_SCORING, ...(rawRules || {}) };
  const numericKeys = [
    'exactScore', 'scoreTeamA', 'scoreTeamB', 'winner', 'qualifier',
    'topScorer', 'bestAttack', 'worstDefense', 'upset'
  ];

  for (const key of numericKeys) {
    const val = Number(rules[key]);
    rules[key] = isNaN(val)
      ? DEFAULT_SCORING[key]
      : Math.max(0, val);
  }

  if (!Array.isArray(rules.podiumPoints)) {
    rules.podiumPoints = [...DEFAULT_SCORING.podiumPoints];
  } else {
    rules.podiumPoints =
      rules.podiumPoints.map(
        v => Math.max(0, Number(v) || 0)
      );
  }

  return rules;
}

function getMatchReferenceScore(match, champRules) {
  if (match.status !== 'finished') {
    return {
      refA: null,
      refB: null,
      refWinner: null
    };
  }

  const useFinalScore =
    champRules?.drawIncludesExtraTime ?? false;

  let refA;
  let refB;

  if (useFinalScore) {
    refA = match.scoreA;
    refB = match.scoreB;
  } else {
    // Usa tempo normal; fallback para scoreA/scoreB
    // caso regularTimeScore não exista.
    refA =
      match.regularTimeScoreA ??
      match.scoreA;

    refB =
      match.regularTimeScoreB ??
      match.scoreB;
  }

  let refWinner = null;

  if (refA != null && refB != null) {
    if (refA > refB) {
      refWinner = 'A';
    } else if (refB > refA) {
      refWinner = 'B';
    } else {
      refWinner = 'draw';
    }
  }

  return {
    refA,
    refB,
    refWinner
  };
}

/**
 * Recalcula a pontuação de todos os usuários
 * baseando-se nas regras dinâmicas do Settings.
 *
 * @param {String} leagueId
 * @param {mongoose.ClientSession} [externalSession]
 * @returns {Promise<{ok: Boolean, updated: Number}>}
 */
async function recalculateAllPoints(
  leagueId = 'default',
  externalSession = null
) {
  const shouldManageSession =
    !externalSession;

  const session =
    externalSession ||
    await mongoose.startSession();

  if (shouldManageSession) {
    session.startTransaction();
  }

  try {
    let settings =
      await Settings.findById(leagueId)
        .lean()
        .session(session);

    if (!settings) {
      console.warn(
        `⚠️ Settings não encontrados para liga ${leagueId}. Usando defaults.`
      );

      settings = {
        _id: leagueId,
        leagueId,
        scoringRules: DEFAULT_SCORING,
        championshipRules:
          DEFAULT_CHAMPIONSHIP_RULES,
        championshipResults: {},
        podium: []
      };
    }

    const scoringRules =
      sanitizeScoringRules(
        settings.scoringRules
      );

    const champRules = {
      ...DEFAULT_CHAMPIONSHIP_RULES,
      ...(settings.championshipRules || {})
    };

    const champResults =
      settings.championshipResults || {};

    const officialPodium =
      settings.podium || [];

    const finishedMatchesRaw =
      await Match
        .find({
          leagueId: String(leagueId),
          status: 'finished'
        })
        .lean()
        .session(session);

    const matchesMap =
      new Map(
        finishedMatchesRaw.map(
          m => [m.matchId, m]
        )
      );

    const bets =
      await Bet
        .find({
          leagueId: String(leagueId)
        })
        .session(session);

    let updated = 0;

    for (const bet of bets) {
      // Guarda o total antes do recálculo.
      const oldTotalPoints =
        bet.totalPoints;

      const podiumSize =
        champRules.podiumSize ?? 4;

      // ==========================================================
      // APOSTA NÃO SUBMETIDA
      // ==========================================================
      if (!bet.hasSubmitted) {
        for (const groupMatch of bet.groupMatches) {
          groupMatch.points = 0;

          groupMatch.pointsBreakdown = {
            exactScore: 0,
            scoreTeamA: 0,
            scoreTeamB: 0,
            winner: 0,
            qualifier: 0
          };
        }

        bet.podiumBreakdown =
          new Array(podiumSize).fill(0);

        bet.extrasBreakdown = {
          topScorer: 0,
          bestAttack: 0,
          worstDefense: 0,
          upset: 0
        };

        bet.lastUpdate =
          new Date();

        bet.recalculateTotals();

        bet.markModified(
          'groupMatches'
        );

        bet.markModified(
          'podiumBreakdown'
        );

        bet.markModified(
          'extrasBreakdown'
        );

        await bet.save({
          session
        });

        if (
          oldTotalPoints !==
          bet.totalPoints
        ) {
          updated++;
        }

        continue;
      }

      // ==========================================================
      // CÁLCULO DAS PARTIDAS
      // ==========================================================
      for (
        const groupMatch
        of bet.groupMatches
      ) {
        const match =
          matchesMap.get(
            groupMatch.matchId
          );

        // Zera antes de recalcular.
        groupMatch.points = 0;

        groupMatch.pointsBreakdown = {
          exactScore: 0,
          scoreTeamA: 0,
          scoreTeamB: 0,
          winner: 0,
          qualifier: 0
        };

        if (
          !match ||
          match.status !== 'finished'
        ) {
          continue;
        }

        const {
          refA,
          refB,
          refWinner
        } =
          getMatchReferenceScore(
            match,
            champRules
          );

        if (
          refA == null ||
          refB == null
        ) {
          continue;
        }

        const betWinner =
          groupMatch.winner;

        const isExact =
          groupMatch.scoreA === refA &&
          groupMatch.scoreB === refB;

        // --------------------------------------------------------
        // 1. PLACAR EXATO
        // --------------------------------------------------------
        if (
          scoringRules.exactScore > 0 &&
          isExact
        ) {
          groupMatch
            .pointsBreakdown
            .exactScore =
            Number(
              scoringRules.exactScore
            ) || 0;
        }

        // --------------------------------------------------------
        // 2. GOLS DO TIME A
        // --------------------------------------------------------
        if (
          scoringRules.scoreTeamA > 0 &&
          groupMatch.scoreA === refA
        ) {
          groupMatch
            .pointsBreakdown
            .scoreTeamA =
            Number(
              scoringRules.scoreTeamA
            ) || 0;
        }

        // --------------------------------------------------------
        // 3. GOLS DO TIME B
        // --------------------------------------------------------
        if (
          scoringRules.scoreTeamB > 0 &&
          groupMatch.scoreB === refB
        ) {
          groupMatch
            .pointsBreakdown
            .scoreTeamB =
            Number(
              scoringRules.scoreTeamB
            ) || 0;
        }

        // --------------------------------------------------------
        // 4. VENCEDOR / EMPATE
        // --------------------------------------------------------
        if (
          scoringRules.winner > 0 &&
          betWinner &&
          betWinner === refWinner
        ) {
          groupMatch
            .pointsBreakdown
            .winner =
            Number(
              scoringRules.winner
            ) || 0;
        }

        // --------------------------------------------------------
        // 5. CLASSIFICADO
        // --------------------------------------------------------
        if (
          scoringRules.qualifier > 0 &&
          match.qualifiedSide &&
          groupMatch.qualifier
        ) {
          if (
            match.qualifiedSide ===
            groupMatch.qualifier
          ) {
            groupMatch
              .pointsBreakdown
              .qualifier =
              Number(
                scoringRules.qualifier
              ) || 0;
          }
        }

        // ========================================================
        // CORREÇÃO:
        // Não usar Object.values() em subdocumento Mongoose.
        // Soma explicitamente os cinco campos numéricos.
        // ========================================================
        groupMatch.points =
          (Number(
            groupMatch.pointsBreakdown
              ?.exactScore
          ) || 0) +

          (Number(
            groupMatch.pointsBreakdown
              ?.scoreTeamA
          ) || 0) +

          (Number(
            groupMatch.pointsBreakdown
              ?.scoreTeamB
          ) || 0) +

          (Number(
            groupMatch.pointsBreakdown
              ?.winner
          ) || 0) +

          (Number(
            groupMatch.pointsBreakdown
              ?.qualifier
          ) || 0);
      }

      // ==========================================================
      // CÁLCULO DO PÓDIO
      // ==========================================================
      const betPodium =
        Array.isArray(bet.podium)
          ? bet.podium
          : [];

      bet.podiumBreakdown =
        new Array(podiumSize)
          .fill(0);

      for (
        let i = 0;
        i < podiumSize;
        i++
      ) {
        const pointsForPosition =
          scoringRules
            .podiumPoints?.[i] || 0;

        if (
          pointsForPosition > 0 &&
          strMatch(
            betPodium[i],
            officialPodium[i]
          )
        ) {
          bet.podiumBreakdown[i] =
            Number(
              pointsForPosition
            ) || 0;
        }
      }

      bet.podiumBreakdown =
        bet.podiumBreakdown
          .slice(
            0,
            podiumSize
          );

      // ==========================================================
      // CÁLCULO DOS EXTRAS
      // ==========================================================
      const userExtras =
        bet.extras || {};

      bet.extrasBreakdown = {
        topScorer: 0,
        bestAttack: 0,
        worstDefense: 0,
        upset: 0
      };

      if (
        scoringRules.topScorer > 0 &&
        strMatch(
          userExtras.topScorer,
          champResults.topScorer
        )
      ) {
        bet.extrasBreakdown
          .topScorer =
          Number(
            scoringRules.topScorer
          ) || 0;
      }

      if (
        scoringRules.bestAttack > 0 &&
        strMatch(
          userExtras.bestAttack,
          champResults.bestAttack
        )
      ) {
        bet.extrasBreakdown
          .bestAttack =
          Number(
            scoringRules.bestAttack
          ) || 0;
      }

      if (
        scoringRules.worstDefense > 0 &&
        strMatch(
          userExtras.worstDefense,
          champResults.worstDefense
        )
      ) {
        bet.extrasBreakdown
          .worstDefense =
          Number(
            scoringRules.worstDefense
          ) || 0;
      }

      if (
        scoringRules.upset > 0 &&
        strMatch(
          userExtras.upset,
          champResults.upset
        )
      ) {
        bet.extrasBreakdown
          .upset =
          Number(
            scoringRules.upset
          ) || 0;
      }

      // ==========================================================
      // RECÁLCULO DOS TOTAIS
      // ==========================================================
      bet.lastUpdate =
        new Date();

      bet.recalculateTotals();

      bet.markModified(
        'groupMatches'
      );

      bet.markModified(
        'podiumBreakdown'
      );

      bet.markModified(
        'extrasBreakdown'
      );

      await bet.save({
        session
      });

      if (
        oldTotalPoints !==
        bet.totalPoints
      ) {
        updated++;
      }
    }

    if (shouldManageSession) {
      await session.commitTransaction();
    }

    console.log(
      `✅ Recálculo concluído! ${updated} apostas modificadas na liga ${leagueId}.`
    );

    return {
      ok: true,
      updated
    };

  } catch (error) {
    if (shouldManageSession) {
      await session.abortTransaction();
    }

    console.error(
      '❌ Erro no recálculo de pontos:',
      error
    );

    throw error;

  } finally {
    if (shouldManageSession) {
      session.endSession();
    }
  }
}

async function getPodium(leagueId) {
  if (!leagueId) return [];

  const doc =
    await Settings.findById(
      leagueId
    ).lean();

  return doc?.podium || [];
}

async function normalizePodiumInput(
  leagueId,
  podiumInput
) {
  if (!leagueId) {
    throw new Error(
      'leagueId é obrigatório'
    );
  }

  const settings =
    await Settings.findById(
      leagueId
    ).lean();

  const podiumSize =
    settings
      ?.championshipRules
      ?.podiumSize ??
    DEFAULT_CHAMPIONSHIP_RULES.podiumSize;

  let podiumArray = [];

  if (Array.isArray(podiumInput)) {
    podiumArray =
      podiumInput
        .map(
          t => String(t).trim()
        )
        .filter(
          t => t.length > 0
        );

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

    for (
      let i = 0;
      i < podiumSize;
      i++
    ) {
      const val =
        podiumInput[String(i)] ??
        podiumInput[
          positionalKeys[i]
        ];

      if (
        val !== undefined &&
        val !== null &&
        String(val).trim() !== ''
      ) {
        podiumArray.push(
          String(val).trim()
        );
      }
    }

  } else if (
    typeof podiumInput === 'string'
  ) {
    podiumArray = [
      podiumInput.trim()
    ];
  }

  if (
    podiumArray.length >
    podiumSize
  ) {
    podiumArray =
      podiumArray.slice(
        0,
        podiumSize
      );
  }

  return {
    podiumArray,
    podiumSize
  };
}

/**
 * Define o pódio oficial e dispara o recálculo global
 * dentro de uma transação atômica.
 */
async function setPodium(
  leagueId,
  podiumInput
) {
  if (!leagueId) {
    throw new Error(
      'leagueId é obrigatório para definir o pódio'
    );
  }

  const {
    podiumArray,
    podiumSize
  } =
    await normalizePodiumInput(
      leagueId,
      podiumInput
    );

  if (
    podiumArray.length >
    podiumSize
  ) {
    throw new Error(
      `Pódio excede o limite de ${podiumSize} times permitidos.`
    );
  }

  let settings =
    await Settings.findById(
      leagueId
    );

  if (!settings) {
    settings =
      new Settings({
        _id: leagueId,
        leagueId,
        scoringRules:
          DEFAULT_SCORING,
        championshipRules:
          DEFAULT_CHAMPIONSHIP_RULES
      });
  }

  settings.podium =
    podiumArray;

  const session =
    await mongoose.startSession();

  session.startTransaction();

  try {
    await settings.save({
      session
    });

    const result =
      await recalculateAllPoints(
        leagueId,
        session
      );

    await session.commitTransaction();

    return {
      ok: true,
      updated:
        result.updated,
      podium:
        podiumArray
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;

  } finally {
    session.endSession();
  }
}

/**
 * Reseta o pódio oficial de uma liga
 * dentro de uma transação atômica.
 */
async function resetPodium(
  leagueId
) {
  if (!leagueId) {
    return {
      ok: false,
      message:
        'leagueId ausente'
    };
  }

  const settings =
    await Settings.findById(
      leagueId
    );

  if (!settings) {
    throw new Error(
      `Configurações não encontradas para a liga ${leagueId}`
    );
  }

  settings.podium = [];

  const session =
    await mongoose.startSession();

  session.startTransaction();

  try {
    await settings.save({
      session
    });

    const result =
      await recalculateAllPoints(
        leagueId,
        session
      );

    await session.commitTransaction();

    return {
      ok: true,
      updated:
        result.updated
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;

  } finally {
    session.endSession();
  }
}

module.exports = {
  recalculateAllPoints,
  getPodium,
  setPodium,
  resetPodium
};
