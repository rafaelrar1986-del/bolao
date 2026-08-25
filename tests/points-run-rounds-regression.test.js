'use strict';
const assert = require('assert');

function normalizePhase(phase) {
  return phase === 'points_run' ? 'pontos_corridos' : (phase || 'group');
}
function groupForMatch(match, phase) {
  return phase === 'pontos_corridos' ? (match.group || match.leagueName || 'Classificação Geral') : match.group;
}

const phase = normalizePhase('points_run');
assert.strictEqual(phase, 'pontos_corridos');
const matches = [
  { phase, group: 'Rodada 3', leagueName: 'Liga X' },
  { phase, group: 'Rodada 4', leagueName: 'Liga X' },
  { phase, group: 'Rodada 5', leagueName: 'Liga X' }
];
assert.strictEqual(new Set(matches.map(m => groupForMatch(m, phase))).size, 3);
assert.deepStrictEqual(
  matches.map(m => m.group),
  ['Rodada 3', 'Rodada 4', 'Rodada 5']
);

// Quando a sincronização usa unifyGroups, todas as rodadas compartilham
// o mesmo agrupador lógico da liga; phaseName continua identificando a rodada.
assert.deepStrictEqual(
  matches.map(m => groupForMatch({ ...m, group: 'Liga X' }, phase)),
  ['Liga X', 'Liga X', 'Liga X']
);
assert.deepStrictEqual(
  matches.map(m => m.group),
  ['Rodada 3', 'Rodada 4', 'Rodada 5']
);
console.log('points-run-rounds-regression.test.js: OK');
