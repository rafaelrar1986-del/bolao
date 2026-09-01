const assert = require('assert');
const { getBetLockState } = require('../services/betLockService');
const {
  getVisibilityLockState,
  isPhaseVisibilityUnlocked,
  getGlobalPredictionVisibilityState
} = require('../services/betVisibilityService');

const now = new Date('2026-09-01T12:00:00Z');
const open = {
  matchId: 1, phase: 'pontos_corridos', group: 'SERIE A',
  phaseName: 'Rodada 3', roundNumber: 3,
  status: 'scheduled', date: '02/09/2026', time: '20:00'
};
const started = { ...open, status: '1_tempo' };

// blockSaveBets bloqueia salvamento, mas NÃO revela palpites.
{
  const s = { blockSaveBets: true, testMode: false, betLockMode: 'grade',
    pointsRunBetAvailabilityMode: 'all', unlockedPhases: ['Rodada 3'] };
  const v = getVisibilityLockState(open, s, false, getBetLockState, false, now, [open]);
  assert.strictEqual(v.editable, true, 'blockSaveBets não deve ser aplicado como lock de partida');
  assert.strictEqual(v.visible, false, 'blockSaveBets não pode revelar');
  assert.strictEqual(v.locked, true);
}

// Mesmo com a visibilidade liberada, enquanto a aposta ainda é editável ela continua privada.
{
  const s = { blockSaveBets: false, betLockMode: 'grade', pointsRunBetAvailabilityMode: 'all', unlockedPhases: ['Rodada 3'] };
  const v = getVisibilityLockState(open, s, false, getBetLockState, false, now, [open]);
  assert.strictEqual(v.editable, true);
  assert.strictEqual(v.visible, false);
}

// Depois do bloqueio real, unlockedPhases libera a visualização.
{
  const s = { blockSaveBets: false, betLockMode: 'grade', pointsRunBetAvailabilityMode: 'all', unlockedPhases: ['Rodada 3'] };
  const v = getVisibilityLockState(started, s, false, getBetLockState, false, now, [started]);
  assert.strictEqual(v.editable, false);
  assert.strictEqual(v.visible, true);
  assert.strictEqual(v.locked, false);
}

// Remover unlockedPhases volta a esconder, mesmo depois de bloqueado.
{
  const s = { blockSaveBets: false, betLockMode: 'grade', pointsRunBetAvailabilityMode: 'all', unlockedPhases: [] };
  const v = getVisibilityLockState(started, s, false, getBetLockState, false, now, [started]);
  assert.strictEqual(v.visible, false);
  assert.strictEqual(v.locked, true);
}

// Chaves dinâmicas de pontos corridos.
assert.strictEqual(isPhaseVisibilityUnlocked(started, { unlockedPhases: ['pontos_corridos'] }), true);
assert.strictEqual(isPhaseVisibilityUnlocked(started, { unlockedPhases: ['Rodada 3'] }), true);
assert.strictEqual(isPhaseVisibilityUnlocked(started, { unlockedPhases: ['rodada 4'] }), false);

// blockSaveBets não decide mais a visibilidade global do pódio.
assert.strictEqual(getGlobalPredictionVisibilityState({ blockSaveBets: true, unlockedPhases: [] }, false, false).visible, false);
assert.strictEqual(getGlobalPredictionVisibilityState({ blockSaveBets: false, unlockedPhases: ['podium'] }, false, false).visible, true);

console.log('bet-visibility-dynamic: PASS');
