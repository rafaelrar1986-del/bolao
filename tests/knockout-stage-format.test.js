const assert = require('assert');
const {
  getEffectiveKnockoutFormat,
  getEffectiveKnockoutLegCount
} = require('../utils/knockoutFormat');

const single = { knockoutFormat: 'single', knockoutFinalFormat: 'home_away' };
assert.strictEqual(getEffectiveKnockoutFormat(single, { phaseName: 'Oitavas' }), 'single');
assert.strictEqual(getEffectiveKnockoutFormat(single, { phaseName: 'Final' }), 'single');
assert.strictEqual(getEffectiveKnockoutLegCount(single, { phaseName: 'Final' }), 1);

const allHomeAway = { knockoutFormat: 'home_away', knockoutFinalFormat: 'home_away' };
assert.strictEqual(getEffectiveKnockoutFormat(allHomeAway, { phaseName: 'Oitavas' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutFormat(allHomeAway, { phaseName: 'Semifinal' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutFormat(allHomeAway, { phaseName: 'Final' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutLegCount(allHomeAway, { phaseName: 'Final' }), 2);

const singleFinal = { knockoutFormat: 'home_away', knockoutFinalFormat: 'single' };
assert.strictEqual(getEffectiveKnockoutFormat(singleFinal, { phaseName: 'Oitavas' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutFormat(singleFinal, { phaseName: 'Quartas' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutFormat(singleFinal, { phaseName: 'Semifinal' }), 'home_away');
assert.strictEqual(getEffectiveKnockoutFormat(singleFinal, { phaseName: 'Final' }), 'single');
assert.strictEqual(getEffectiveKnockoutLegCount(singleFinal, { phaseName: 'Final' }), 1);
assert.strictEqual(getEffectiveKnockoutFormat(singleFinal, { roundName: 'Final' }), 'single');

console.log('knockout-stage-format: PASS');
