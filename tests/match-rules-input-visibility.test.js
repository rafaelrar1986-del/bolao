'use strict';
const assert = require('assert');

const SCORE = new Set(['exactScore','scoreTeamA','scoreTeamB','scoreWinner','scoreLoser','totalGoals','goalDifference']);
function needScore(rules){ return rules.some(r => (r.conditions||[]).some(c => SCORE.has(c))); }
function needWinner(rules){ return rules.some(r => (r.conditions||[]).includes('result')); }

assert.strictEqual(needScore([{conditions:['result']}]), false);
assert.strictEqual(needScore([{conditions:['exactScore']}]), true);
assert.strictEqual(needScore([{conditions:['result','scoreWinner']}]), true);
assert.strictEqual(needScore([{conditions:['result']},{conditions:['totalGoals']}]), true);
assert.strictEqual(needScore([{conditions:['result']},{conditions:['qualifier']}]), false);
assert.strictEqual(needWinner([{conditions:['result']}]), true);
assert.strictEqual(needWinner([{conditions:['scoreWinner']}]), false);
assert.strictEqual(needWinner([{conditions:['totalGoals']}]), false);
console.log('match-rules-input-visibility.test.js: OK');
