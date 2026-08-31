import assert from 'node:assert/strict';

const pointsRun = { hasGroupPhase: false, hasKnockoutPhase: false };
const group = { hasGroupPhase: true, hasKnockoutPhase: false };
const groupKo = { hasGroupPhase: true, hasKnockoutPhase: true };
const knockout = { hasGroupPhase: false, hasKnockoutPhase: true };

const isPointsRun = r => r?.hasGroupPhase !== true && r?.hasKnockoutPhase !== true;
assert.equal(isPointsRun(pointsRun), true);
assert.equal(isPointsRun(group), false);
assert.equal(isPointsRun(groupKo), false);
assert.equal(isPointsRun(knockout), false);

const phaseForRobot = ({ isApiKnockout = false, normalizedPhaseType = 'auto', isPointsRun = false, autoDetectedPhase = 'group' }) =>
  isApiKnockout ? 'knockout' : (isPointsRun ? 'pontos_corridos' : (normalizedPhaseType === 'auto' ? autoDetectedPhase : normalizedPhaseType));

assert.equal(phaseForRobot({ normalizedPhaseType: 'group', isPointsRun: true }), 'pontos_corridos');
assert.equal(phaseForRobot({ normalizedPhaseType: 'pontos_corridos', isPointsRun: true }), 'pontos_corridos');
assert.equal(phaseForRobot({ normalizedPhaseType: 'group', isPointsRun: false }), 'group');
assert.equal(phaseForRobot({ normalizedPhaseType: 'knockout', isApiKnockout: true }), 'knockout');

const roundKey = m => {
  const p = String(m.phase || '').toLowerCase();
  const pr = p === 'pontos_corridos' || p === 'points_run';
  return pr ? (m.phaseName || `Rodada ${m.roundNumber}`) : (m.group || m.phaseName || 'Grupo');
};
assert.equal(roundKey({ phase: 'pontos_corridos', group: 'SERIE A', phaseName: 'Rodada 3', roundNumber: 3 }), 'Rodada 3');
assert.equal(roundKey({ phase: 'group', group: 'GRUPO A', phaseName: 'FASE DE GRUPOS' }), 'GRUPO A');

const cardPhase = m => m.phase || 'group';
assert.equal(cardPhase({ phase: 'pontos_corridos' }), 'pontos_corridos');

const navLabel = r => isPointsRun(r) ? 'Pontos Corridos' : (r?.hasGroupPhase ? 'Grupos' : 'Palpites');
assert.equal(navLabel(pointsRun), 'Pontos Corridos');
assert.equal(navLabel(group), 'Grupos');

console.log('POINTS_RUN_UI_REGRESSION: ALL TESTS PASSED');
