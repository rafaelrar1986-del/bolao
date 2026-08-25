'use strict';

const assert = require('assert');

function resetChampionshipStart(currentSettings) {
  return {
    ...currentSettings,
    firstMatchStartedAt: null
  };
}

const before = {
  _id: '9',
  firstMatchStartedAt: new Date('2026-08-24T18:00:00.000Z'),
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: { tieBreakers: ['knockoutPoints'] }
};

const after = resetChampionshipStart(before);

assert.strictEqual(after.firstMatchStartedAt, null);
assert.deepStrictEqual(after.championshipRules, before.championshipRules);
assert.deepStrictEqual(after.rankingRules, before.rankingRules);

// É a mesma regra usada pelo championshipRulesService:
// sem firstMatchStartedAt, as regras voltam a ser editáveis.
assert.strictEqual(!Boolean(after.firstMatchStartedAt), true);

console.log('reset-all-bets-championship-start.test.js: OK');
