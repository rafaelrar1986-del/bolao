'use strict';
const assert = require('assert');
function q(totalTeams, groupCount, totalQualified) {
  if (totalTeams % groupCount !== 0) throw new Error('not divisible');
  const perGroup = Math.floor(totalQualified / groupCount);
  const additional = totalQualified % groupCount;
  return { teamsPerGroup: totalTeams / groupCount, perGroup, additional, additionalPosition: additional ? perGroup + 1 : null };
}
assert.deepStrictEqual(q(48,12,32), {teamsPerGroup:4,perGroup:2,additional:8,additionalPosition:3});
assert.deepStrictEqual(q(32,8,16), {teamsPerGroup:4,perGroup:2,additional:0,additionalPosition:null});
assert.deepStrictEqual(q(24,6,16), {teamsPerGroup:4,perGroup:2,additional:4,additionalPosition:3});
assert.throws(() => q(47,12,32));
console.log('group-qualification-generic.test.js: OK');
