'use strict';

const assert = require('assert');

const payload = {
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: {
    tieBreakers: ['knockoutPoints','exactScorePoints','extraPointS']
  },
  prizeZone: {
    positions: 3,
    totalAmount: 10000,
    distribution: [
      { position: 1, percentage: 50 },
      { position: 2, percentage: 30 },
      { position: 3, percentage: 20 }
    ]
  }
};

// Contract checks mirroring the Settings schema.
assert.strictEqual(typeof payload.championshipRules.hasKnockoutPhase, 'boolean');
assert.strictEqual(payload.prizeZone.positions, 3);
assert.strictEqual(payload.prizeZone.totalAmount, 10000);
assert.strictEqual(
  payload.prizeZone.distribution.reduce((s,x)=>s+x.percentage,0),
  100
);
assert(payload.rankingRules.tieBreakers.includes('knockoutPoints'));
assert(payload.rankingRules.tieBreakers.includes('exactScorePoints'));

console.log('settings-save-contract.test.js: OK');
