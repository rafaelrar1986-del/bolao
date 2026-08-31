import assert from 'node:assert/strict';

const scoreConditions = new Set([
  'exactScore','scoreTeamA','scoreTeamB','scoreWinner','scoreLoser','totalGoals','goalDifference'
]);
function hasScoreInput(rules = {}) {
  if (Array.isArray(rules.matchRules)) {
    return rules.matchRules.some(rule =>
      Number(rule?.points) > 0 &&
      Array.isArray(rule?.conditions) &&
      rule.conditions.some(c => scoreConditions.has(c))
    );
  }
  return (Number(rules.exactScore)||0)>0 || (Number(rules.scoreTeamA)||0)>0 || (Number(rules.scoreTeamB)||0)>0;
}

assert.equal(hasScoreInput({matchRules: []}), false, 'sem regras: não deve exibir placar');
assert.equal(hasScoreInput({matchRules:[{points:0,conditions:['exactScore']}]}), false, 'regra de placar com 0 pontos não exige campo');
assert.equal(hasScoreInput({matchRules:[{points:2,conditions:['result']}]}), false, 'resultado não exige placar');
assert.equal(hasScoreInput({matchRules:[{points:2,conditions:['exactScore']}]}), true, 'placar exato com pontos exige campo');
assert.equal(hasScoreInput({matchRules:[{points:3,conditions:['scoreWinner']}]}), true, 'gols do vencedor com pontos exige campo');
assert.equal(hasScoreInput({matchRules:[{points:0,conditions:['result']},{points:4,conditions:['goalDifference']}]}), true, 'qualquer categoria de placar com pontos > 0 exige campo');
assert.equal(hasScoreInput({exactScore:5,scoreTeamA:0,scoreTeamB:0}), true, 'configuração legada sem matchRules preserva compatibilidade');

console.log('score-input-rules-regression: ALL TESTS PASSED');
