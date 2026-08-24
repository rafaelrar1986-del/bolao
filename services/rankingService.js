'use strict';

const ALLOWED_TIE_BREAKERS = [
  'exactScorePoints',
  'podiumPoints',
  'extraPoints',
  'knockoutPoints'
];

function normalizeTieBreakers(raw, settings = {}) {
  const requested = Array.isArray(raw)
    ? raw
    : Array.isArray(settings?.rankingRules?.tieBreakers)
      ? settings.rankingRules.tieBreakers
      : [];

  const available = new Set([
    'exactScorePoints',
    'podiumPoints',
    'extraPoints'
  ]);

  if (settings?.championshipRules?.hasKnockoutPhase === true) {
    available.add('knockoutPoints');
  }

  const result = [];
  for (const value of requested) {
    if (!ALLOWED_TIE_BREAKERS.includes(value)) continue;
    if (!available.has(value)) continue;
    if (result.includes(value)) continue;
    result.push(value);
    if (result.length === 3) break;
  }
  return result;
}

function getTieBreakerMetrics(bet, computed) {
  const exactScorePoints = (bet?.groupMatches || []).reduce(
    (sum, item) => sum + Number(item?.pointsBreakdown?.exactScore || 0),
    0
  );

  const podiumPoints = Number(
    computed?.podiumPoints ??
    (bet?.podiumBreakdown || []).reduce(
      (sum, value) => sum + Number(value || 0), 0
    )
  );

  const extraPoints = Number(
    computed?.extrasPoints ??
    (bet?.extrasBreakdown
      ? Object.values(bet.extrasBreakdown).reduce(
          (sum, value) => sum + Number(value || 0), 0
        )
      : 0)
  );

  const knockoutPoints = Number(computed?.knockoutPoints || 0);

  return {
    exactScorePoints,
    podiumPoints,
    extraPoints,
    knockoutPoints
  };
}

function compareBySportsRanking(a, b, tieBreakers = []) {
  const totalDiff =
    Number(b.totalPoints ?? b.points ?? 0) -
    Number(a.totalPoints ?? a.points ?? 0);

  if (totalDiff !== 0) return totalDiff;

  for (const criterion of tieBreakers) {
    const diff =
      Number(b.tieBreakerMetrics?.[criterion] || 0) -
      Number(a.tieBreakerMetrics?.[criterion] || 0);

    if (diff !== 0) return diff;
  }

  return 0;
}

function assignSportsPositions(ranked) {
  let position = 0;
  let previous = null;

  return ranked.map((item, index) => {
    const sameRank =
      previous &&
      Number(item.totalPoints ?? item.points ?? 0) ===
        Number(previous.totalPoints ?? previous.points ?? 0) &&
      (previous.__rankingTieKey || '') ===
        (item.__rankingTieKey || '');

    if (!sameRank) position = index + 1;

    previous = item;

    return { ...item, position };
  });
}

function calculatePrizeAllocation(ranked, prizeZone) {
  const positions = Math.max(
    0, Math.floor(Number(prizeZone?.positions || 0))
  );
  const totalAmount = Math.max(
    0, Number(prizeZone?.totalAmount || 0)
  );

  if (!positions || !totalAmount) {
    return ranked.map(item => ({
      ...item,
      prizeEligible: false,
      prizeAmount: 0,
      prizePercentage: 0
    }));
  }

  const distribution = new Map(
    (Array.isArray(prizeZone?.distribution)
      ? prizeZone.distribution
      : []
    ).map(item => [
      Number(item.position),
      Number(item.percentage || 0)
    ])
  );

  const groups = new Map();
  for (const item of ranked) {
    if (Number(item.position) > positions) continue;
    if (!groups.has(item.position)) groups.set(item.position, []);
    groups.get(item.position).push(item);
  }

  return ranked.map(item => {
    const group = groups.get(item.position);
    if (!group) {
      return {
        ...item,
        prizeEligible: false,
        prizeAmount: 0,
        prizePercentage: 0
      };
    }

    // Um empate ocupa N posições consecutivas.
    // Soma os percentuais dessas posições e divide igualmente.
    let combinedPercentage = 0;
    for (let i = 0; i < group.length; i++) {
      combinedPercentage += Number(
        distribution.get(Number(item.position) + i) || 0
      );
    }

    const prizePercentage = combinedPercentage / group.length;
    const prizeAmount =
      totalAmount * prizePercentage / 100;

    return {
      ...item,
      prizeEligible: true,
      prizePercentage,
      prizeAmount: Math.round(prizeAmount * 100) / 100
    };
  });
}

module.exports = {
  ALLOWED_TIE_BREAKERS,
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
};
