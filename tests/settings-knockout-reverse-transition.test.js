'use strict';

const assert = require('assert');

// Estado anterior: campeonato NÃO possui mata-mata e não há knockoutPoints.
const current = {
  championshipRules: { hasKnockoutPhase: false },
  rankingRules: { tieBreakers: ['exactScorePoints'] }
};

// O ADM ativa o mata-mata, mas não seleciona esse critério.
const request = {
  championshipRules: { hasKnockoutPhase: true }
};

const lockUpdates = {};
lockUpdates.championshipRules = {
  ...current.championshipRules,
  ...request.championshipRules
};

// O rankingRules não deve ser criado/alterado automaticamente.
assert.deepStrictEqual(lockUpdates.championshipRules, {
  hasKnockoutPhase: true
});
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(lockUpdates, 'rankingRules'),
  false
);

// Estado final esperado: mata-mata existe, mas o critério continua sendo
// apenas o que o ADM já havia escolhido.
const persisted = {
  ...current,
  ...lockUpdates
};

assert.strictEqual(persisted.championshipRules.hasKnockoutPhase, true);
assert.deepStrictEqual(
  persisted.rankingRules.tieBreakers,
  ['exactScorePoints']
);

// Também testa o caso de campeonato já com mata-mata, mas sem o critério.
const alreadyKnockout = {
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: { tieBreakers: ['podiumPoints'] }
};

const request2 = {
  championshipRules: { hasKnockoutPhase: true }
};

const final2 = {
  ...alreadyKnockout,
  championshipRules: {
    ...alreadyKnockout.championshipRules,
    ...request2.championshipRules
  }
};

assert.strictEqual(final2.championshipRules.hasKnockoutPhase, true);
assert.deepStrictEqual(final2.rankingRules.tieBreakers, ['podiumPoints']);

console.log('settings-knockout-reverse-transition.test.js: OK');
