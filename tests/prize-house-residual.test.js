'use strict';

const assert = require('assert');
const { calculatePrizeAllocation } = require('../services/rankingService');

const ranking = [
  { user:{name:'João'}, position:1, totalPoints:100 },
  { user:{name:'Maria'}, position:1, totalPoints:100 },
  { user:{name:'Pedro'}, position:1, totalPoints:100 }
];

const result = calculatePrizeAllocation(ranking, {
  positions: 1,
  totalAmount: 100,
  distribution: [{ position:1, percentage:100 }]
});

const paid = Number(result
  .filter(x => x.prizeEligible)
  .reduce((sum,x) => sum + Number(x.prizeAmount || 0), 0)
  .toFixed(2));

const residual = Number((100 - paid).toFixed(2));

assert.deepStrictEqual(
  result.filter(x => x.prizeEligible).map(x => x.prizeAmount),
  [33.33, 33.33, 33.33]
);
assert.strictEqual(paid, 99.99);
assert.strictEqual(residual, 0.01);

// Nenhum premiado recebe o centavo residual.
assert.strictEqual(
  Math.max(...result.filter(x => x.prizeEligible).map(x => x.prizeAmount)),
  33.33
);

console.log('prize-house-residual.test.js: OK');
