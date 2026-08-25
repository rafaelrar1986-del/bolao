'use strict';

const assert = require('assert');

function reconcile(currentSettings, lockUpdates) {
  if (lockUpdates.championshipRules?.hasKnockoutPhase === false) {
    const currentTieBreakers = Array.isArray(
      currentSettings?.rankingRules?.tieBreakers
    ) ? currentSettings.rankingRules.tieBreakers : [];

    const requestedTieBreakers = Array.isArray(
      lockUpdates.rankingRules?.tieBreakers
    ) ? lockUpdates.rankingRules.tieBreakers : currentTieBreakers;

    lockUpdates.rankingRules = {
      ...(currentSettings?.rankingRules || {}),
      ...(lockUpdates.rankingRules || {}),
      tieBreakers: requestedTieBreakers.filter(
        value => value !== 'knockoutPoints'
      )
    };
  }
  return { ...currentSettings, ...lockUpdates };
}

// parcial: só championshipRules
let result = reconcile({
  championshipRules:{hasKnockoutPhase:true},
  rankingRules:{tieBreakers:['knockoutPoints','exactScorePoints']}
}, {
  championshipRules:{hasKnockoutPhase:false}
});
assert.deepStrictEqual(result.rankingRules?.tieBreakers,['exactScorePoints']);

// parcial: preserva os demais critérios
result = reconcile({
  championshipRules:{hasKnockoutPhase:true},
  rankingRules:{tieBreakers:['podiumPoints','knockoutPoints','extraPoints']}
}, {
  championshipRules:{hasKnockoutPhase:false}
});
assert.deepStrictEqual(result.rankingRules.tieBreakers,['podiumPoints','extraPoints']);

// completo: remove knockoutPoints do payload também
result = reconcile({
  championshipRules:{hasKnockoutPhase:true},
  rankingRules:{tieBreakers:['knockoutPoints','exactScorePoints']}
}, {
  championshipRules:{hasKnockoutPhase:false},
  rankingRules:{tieBreakers:['knockoutPoints','exactScorePoints']}
});
assert.deepStrictEqual(result.rankingRules?.tieBreakers,['exactScorePoints']);

// ativar: não adiciona automaticamente
result = reconcile({
  championshipRules:{hasKnockoutPhase:false},
  rankingRules:{tieBreakers:['exactScorePoints']}
}, {
  championshipRules:{hasKnockoutPhase:true}
});
assert.deepStrictEqual(result.rankingRules?.tieBreakers,['exactScorePoints']);

console.log('settings-knockout-reconciliation.test.js: OK');
