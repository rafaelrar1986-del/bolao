
const assert = require('assert');
const {
  getBetLockMode,
  getBetLockState
} = require('../services/betLockService');

const before = new Date(Date.UTC(2026, 7, 22, 14, 59));
const exact = new Date(Date.UTC(2026, 7, 22, 15, 0));
const after = new Date(Date.UTC(2026, 7, 22, 15, 1));

const match = {
  matchId: 1,
  date: '22/08/2026',
  time: '15:00',
  status: 'scheduled',
  phaseName: 'quartas',
  group: 'quartas'
};

assert.strictEqual(getBetLockMode({ betLockMode: 'match' }), 'match');
assert.strictEqual(getBetLockMode({ betLockMode: 'grade' }), 'grade');

assert.strictEqual(
  getBetLockState(match, { betLockMode: 'match' }, before).locked,
  false
);

assert.strictEqual(
  getBetLockState(match, { betLockMode: 'match' }, exact).locked,
  true
);

assert.strictEqual(
  getBetLockState(match, { betLockMode: 'match' }, after).reason,
  'match_started'
);

assert.strictEqual(
  getBetLockState(
    match,
    { betLockMode: 'grade', lockedPhases: ['quartas'] },
    before
  ).reason,
  'grade_locked'
);

assert.strictEqual(
  getBetLockState(
    match,
    { betLockMode: 'grade', lockedPhases: ['semifinal'] },
    before
  ).locked,
  false
);

assert.strictEqual(
  getBetLockState(
    match,
    { betLockMode: 'grade', lockedPhases: [] },
    after
  ).reason,
  'match_started'
);

console.log('6/6 TESTES CRÍTICOS DO betLockService: PASS');
