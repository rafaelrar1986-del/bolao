
'use strict';
const assert=require('assert');
const {scoresAreEnabled}=require('../services/betValidationService');

assert.strictEqual(
  scoresAreEnabled({matchRules:[{points:5,conditions:['result']},{points:2,conditions:['qualifier']}]}),
  false
);

assert.strictEqual(
  scoresAreEnabled({matchRules:[{points:5,conditions:['result','qualifier']}]}),
  false
);

assert.strictEqual(
  scoresAreEnabled({matchRules:[{points:5,conditions:['result','scoreWinner']}]}),
  true
);

assert.strictEqual(
  scoresAreEnabled({matchRules:[{points:5,conditions:['totalGoals']}]}),
  true
);

assert.strictEqual(
  scoresAreEnabled({matchRules:[]}),
  false
);

// Legacy behavior remains compatible.
assert.strictEqual(scoresAreEnabled({exactScore:5}),true);
assert.strictEqual(scoresAreEnabled({exactScore:0,scoreTeamA:0,scoreTeamB:0}),false);

console.log('custom-rules-score-requirement.test.js: OK');
