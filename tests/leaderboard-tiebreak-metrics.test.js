'use strict';

const assert = require('assert');
const { getTieBreakerMetrics, compareBySportsRanking } =
  require('../services/rankingService');

// O leaderboard deve preferir a métrica recém-calculada em memória.
const metrics = getTieBreakerMetrics(
  { groupMatches: [{ pointsBreakdown: { exactScore: 999 } }] },
  {
    exactScorePoints: 20,
    podiumPoints: 0,
    extrasPoints: 0,
    knockoutPoints: 0
  }
);

assert.strictEqual(metrics.exactScorePoints, 20);

const a = {
  totalPoints: 100,
  tieBreakerMetrics: metrics
};
const b = {
  totalPoints: 100,
  tieBreakerMetrics: {
    exactScorePoints: 15,
    podiumPoints: 0,
    extrasPoints: 0,
    knockoutPoints: 0
  }
};

assert(compareBySportsRanking(a, b, ['exactScorePoints']) < 0);

console.log('leaderboard-tiebreak-metrics.test.js: OK');
