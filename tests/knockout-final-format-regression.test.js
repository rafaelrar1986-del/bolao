
const assert = require('assert');
const {
  isFinalStage,
  getEffectiveKnockoutFormat,
  getEffectiveKnockoutLegCount,
  buildKnockoutTieKey
} = require('../utils/knockoutFormat');

const allHomeAway = { knockoutFormat: 'home_away', knockoutFinalFormat: 'home_away' };
const finalSingle = { knockoutFormat: 'home_away', knockoutFinalFormat: 'single' };
const allSingle = { knockoutFormat: 'single', knockoutFinalFormat: 'home_away' };

for (const stage of ['Oitavas de final', 'Quartas de final', 'Semifinal']) {
  assert.strictEqual(isFinalStage(stage), false);
  assert.strictEqual(getEffectiveKnockoutFormat(finalSingle, { phaseName: stage }), 'home_away');
  assert.strictEqual(getEffectiveKnockoutLegCount(finalSingle, { phaseName: stage }), 2);
}
for (const stage of ['Final', 'Final do campeonato', 'Finalíssima']) {
  assert.strictEqual(isFinalStage(stage), true);
  assert.strictEqual(getEffectiveKnockoutFormat(finalSingle, { phaseName: stage }), 'single');
  assert.strictEqual(getEffectiveKnockoutLegCount(finalSingle, { phaseName: stage }), 1);
}
assert.strictEqual(getEffectiveKnockoutFormat(allHomeAway, { phaseName: 'Final' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutLegCount(allHomeAway, { phaseName: 'Final' }), 2);
assert.strictEqual(getEffectiveKnockoutFormat(allSingle, { phaseName: 'Final' }), 'single');
assert.strictEqual(getEffectiveKnockoutLegCount(allSingle, { phaseName: 'Final' }), 1);

const k1 = buildKnockoutTieKey('Semifinal', 'São Paulo', 'Flamengo');
const k2 = buildKnockoutTieKey('Semifinal', 'Flamengo', 'Sao Paulo');
assert.strictEqual(k1, k2);
assert.notStrictEqual(k1, buildKnockoutTieKey('Final', 'São Paulo', 'Flamengo'));

console.log('knockout-final-format-regression: PASS');
