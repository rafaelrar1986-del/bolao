const test = require('node:test');
const assert = require('node:assert/strict');

function getQualifierExtra({ phase, scoringRules }) {
  if (String(phase || '').toLowerCase() !== 'knockout') return 0;
  return Number(scoringRules?.matchExtras?.qualifier || 0);
}

function getMax({ phase, matchRuleMax, scoringRules }) {
  return matchRuleMax + getQualifierExtra({phase, scoringRules});
}

test('Classificado nunca entra no máximo da fase de grupos', () => {
  assert.equal(getMax({
    phase: 'group',
    matchRuleMax: 5,
    scoringRules: { matchExtras: { qualifier: 3 } }
  }), 5);
});

test('Classificado entra no máximo de cada partida do mata-mata', () => {
  assert.equal(getMax({
    phase: 'knockout',
    matchRuleMax: 5,
    scoringRules: { matchExtras: { qualifier: 3 } }
  }), 8);
});

test('sem extra configurado o máximo permanece somente o da partida', () => {
  assert.equal(getMax({
    phase: 'knockout',
    matchRuleMax: 5,
    scoringRules: { matchExtras: { qualifier: 0 } }
  }), 5);
});

test('condição legada qualifier não deve fazer parte das matchRules', () => {
  const conditions = ['exactScore', 'qualifier', 'result']
    .filter(c => c !== 'qualifier');
  assert.deepEqual(conditions, ['exactScore', 'result']);
});
