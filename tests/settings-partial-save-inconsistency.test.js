'use strict';

const assert = require('assert');

// Simula o comportamento relevante do endpoint quando chega SOMENTE
// championshipRules, sem rankingRules.
// Estado já salvo:
const current = {
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: { tieBreakers: ['knockoutPoints'] }
};

// Payload do ADM ao desmarcar mata-mata e salvar somente essa seção.
const request = {
  championshipRules: { hasKnockoutPhase: false }
};

// Mesma combinação usada no route para construir lockUpdates.
const lockUpdates = {};
lockUpdates.championshipRules = {
  ...current.championshipRules,
  ...request.championshipRules
};

// Como rankingRules não veio na requisição, a implementação atual não altera
// lockUpdates.rankingRules.
assert.deepStrictEqual(lockUpdates.championshipRules, {
  hasKnockoutPhase: false
});
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(lockUpdates, 'rankingRules'),
  false
);

// O estado persistido, portanto, poderia ficar inconsistente.
const persisted = {
  ...current,
  ...lockUpdates
};

assert.strictEqual(persisted.championshipRules.hasKnockoutPhase, false);
assert.deepStrictEqual(
  persisted.rankingRules.tieBreakers,
  ['knockoutPoints']
);

console.log('settings-partial-save-inconsistency.test.js: CONFIRMADO');
