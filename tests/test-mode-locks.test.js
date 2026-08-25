
'use strict';
const assert = require('assert');
const { getBetLockState } = require('../services/betLockService');
const {
  canEditChampionshipRules,
  assertChampionshipRulesEditable
} = require('../services/championshipRulesService');

const finished = {
  status: 'finished',
  date: '24/08/2026',
  time: '10:00',
  group: 'A',
  phase: 'group'
};

const normalSettings = {
  testMode: false,
  betLockMode: 'grade',
  lockedPhases: [],
  firstMatchStartedAt: new Date('2026-08-24T10:00:00.000Z')
};

assert.strictEqual(getBetLockState(finished, normalSettings, new Date('2026-08-25T12:00:00.000Z')).locked, true);
assert.strictEqual(canEditChampionshipRules(normalSettings), false);
assert.throws(() => assertChampionshipRulesEditable(normalSettings));

const testSettings = {
  ...normalSettings,
  testMode: true
};

assert.deepStrictEqual(
  getBetLockState(finished, testSettings, new Date('2026-08-25T12:00:00.000Z')),
  { mode: 'test', locked: false, reason: null }
);

assert.strictEqual(canEditChampionshipRules(testSettings), true);
assert.doesNotThrow(() => assertChampionshipRulesEditable(testSettings));

console.log('test-mode-locks.test.js: OK');
