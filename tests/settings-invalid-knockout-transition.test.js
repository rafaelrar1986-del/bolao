'use strict';

const assert = require('assert');

function validateTieBreakers(requested, championshipRules, scoringRules) {
  if (requested.length > 3) {
    return { ok:false, message:'São permitidos no máximo 3 critérios de desempate.' };
  }

  const allowed = [
    'exactScorePoints',
    'podiumPoints',
    'extraPoints',
    'knockoutPoints'
  ];

  const available = new Set([
    ...(Number(scoringRules.exactScore || 0) > 0 ? ['exactScorePoints'] : []),
    ...(Array.isArray(scoringRules.podiumPoints) &&
      scoringRules.podiumPoints.some(v => Number(v) > 0)
      ? ['podiumPoints'] : []),
    ...(
      ['topScorer','bestAttack','worstDefense','upset']
        .some(key => Number(scoringRules[key] || 0) > 0)
        ? ['extraPoints'] : []
    ),
    ...(championshipRules.hasKnockoutPhase === true
      ? ['knockoutPoints'] : [])
  ]);

  const unique = [];
  for (const value of requested) {
    if (!allowed.includes(value) || !available.has(value)) {
      return { ok:false, message:`Critério de desempate indisponível: ${value}` };
    }
    if (unique.includes(value)) {
      return { ok:false, message:'Os critérios de desempate não podem se repetir.' };
    }
    unique.push(value);
  }
  return {ok:true, value:unique};
}

// Situação salva anteriormente: mata-mata existe e knockoutPoints é selecionado.
// Nova tentativa: mata-mata = false, mas mantém knockoutPoints.
const result = validateTieBreakers(
  ['knockoutPoints'],
  {hasKnockoutPhase:false},
  {exactScore:2, podiumPoints:[10,5], topScorer:0,bestAttack:0,worstDefense:0,upset:0}
);

assert.strictEqual(result.ok, false);
assert.strictEqual(
  result.message,
  'Critério de desempate indisponível: knockoutPoints'
);

// Se o ADM desligar mata-mata e remover o critério, deve ser aceito.
const corrected = validateTieBreakers(
  [],
  {hasKnockoutPhase:false},
  {exactScore:2, podiumPoints:[10,5], topScorer:0,bestAttack:0,worstDefense:0,upset:0}
);
assert.strictEqual(corrected.ok, true);
assert.deepStrictEqual(corrected.value, []);

console.log('settings-invalid-knockout-transition.test.js: OK');
