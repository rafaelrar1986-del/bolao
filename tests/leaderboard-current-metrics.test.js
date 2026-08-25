'use strict';

const assert = require('assert');
const { getTieBreakerMetrics, compareBySportsRanking } =
  require('../services/rankingService');

// Podium/Extras devem usar o cálculo atual retornado pelo pointsService,
// mesmo se existirem valores antigos no documento da aposta.
const metrics = getTieBreakerMetrics(
  {
    podiumBreakdown: [999],
    extrasBreakdown: { topScorer: 999 }
  },
  {
    exactScorePoints: 0,
    podiumPoints: 30,
    extrasPoints: 12,
    knockoutPoints: 0
  }
);

assert.strictEqual(metrics.podiumPoints, 30);
assert.strictEqual(metrics.extraPoints, 12);

const a = {
  totalPoints: 100,
  tieBreakerMetrics: metrics
};
const b = {
  totalPoints: 100,
  tieBreakerMetrics: {
    exactScorePoints: 0,
    podiumPoints: 20,
    extraPoints: 8,
    knockoutPoints: 0
  }
};

assert(compareBySportsRanking(a, b, ['podiumPoints', 'extraPoints']) < 0);

console.log('leaderboard-current-metrics.test.js: OK');
