const test = require('node:test');
const assert = require('node:assert/strict');

function qualifierPoints({ phase, hasKnockoutPhase, configured, betQualifier, referenceQualifier }) {
  if (!hasKnockoutPhase) return 0;
  if (String(phase || '').toLowerCase() !== 'knockout') return 0;
  const pts = Number(configured);
  if (!(pts > 0)) return 0;
  if (!betQualifier || !referenceQualifier) return 0;
  return String(betQualifier) === String(referenceQualifier) ? pts : 0;
}

test('classificado pontua somente em mata-mata', () => {
  assert.equal(qualifierPoints({
    phase: 'group', hasKnockoutPhase: true, configured: 2,
    betQualifier: 'A', referenceQualifier: 'A'
  }), 0);

  assert.equal(qualifierPoints({
    phase: 'knockout', hasKnockoutPhase: true, configured: 2,
    betQualifier: 'A', referenceQualifier: 'A'
  }), 2);
});

test('classificado não pontua sem fase mata-mata', () => {
  assert.equal(qualifierPoints({
    phase: 'knockout', hasKnockoutPhase: false, configured: 2,
    betQualifier: 'A', referenceQualifier: 'A'
  }), 0);
});

test('classificado errado vale zero', () => {
  assert.equal(qualifierPoints({
    phase: 'knockout', hasKnockoutPhase: true, configured: 2,
    betQualifier: 'A', referenceQualifier: 'B'
  }), 0);
});
