const assert = require('assert');
const {
  getBetLockState
} = require('../services/betLockService');
const {
  getVisibilityLockState,
  getGlobalPredictionVisibilityState,
  getVisibleBetData,
  maskGroupPredictions,
  maskPodium,
  maskExtras
} = require('../services/betVisibilityService');

const now = new Date('2026-08-31T12:00:00Z');
const match = {
  matchId: 1,
  phase: 'group',
  group: 'A',
  phaseName: 'Grupo A',
  roundNumber: 1,
  status: 'scheduled',
  date: '01/09/2026',
  time: '23:00'
};

function visibility(settings, isAdmin = false, isOwner = false, m = match) {
  return getVisibilityLockState(
    m,
    settings,
    isAdmin,
    getBetLockState,
    isOwner,
    now
  );
}

// Regra principal: enquanto o usuário pode editar, terceiros ficam ocultos.
{
  const state = visibility({
    testMode: true,
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [1],
    lockedGroupRounds: []
  });
  assert.strictEqual(state.editable, true);
  assert.strictEqual(state.locked, true);
}

// Rodada liberada continua privada até o início da partida.
{
  const state = visibility({
    testMode: false,
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [1],
    lockedGroupRounds: []
  });
  assert.strictEqual(state.editable, true);
  assert.strictEqual(state.locked, true);
}

// Rodada não liberada: continua privada; disponibilidade e visibilidade são controles distintos.
{
  const state = visibility({
    testMode: false,
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [],
    lockedGroupRounds: [],
    unlockedPhases: []
  });
  assert.strictEqual(state.editable, false);
  assert.strictEqual(state.visible, false);
  assert.strictEqual(state.locked, true);
}

// Partida iniciada: só fica pública se a fase também estiver liberada em unlockedPhases.
{
  const state = visibility(
    {
      testMode: false,
      betLockMode: 'grade',
      groupBetAvailabilityMode: 'round',
      unlockedGroupRounds: [1],
      lockedGroupRounds: [],
      unlockedPhases: ['Grupo A']
    },
    false,
    false,
    { ...match, status: 'in_progress' }
  );
  assert.strictEqual(state.editable, false);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.locked, false);
}

// Admin e próprio usuário continuam vendo os próprios dados.
assert.strictEqual(
  visibility({ blockSaveBets: false }, true).locked,
  false
);
assert.strictEqual(
  visibility({ blockSaveBets: false }, false, true).locked,
  false
);

// Nenhum componente do palpite pode vazar enquanto estiver privado.
{
  const masked = getVisibleBetData(
    { matchId: 1, winner: 'A', scoreA: 2, scoreB: 1, qualifier: 'A' },
    match,
    { locked: true, editable: true }
  );
  assert.strictEqual(masked.isLocked, true);
  assert.strictEqual(masked.choice, '🔒');
  assert.strictEqual(masked.scoreA, null);
  assert.strictEqual(masked.scoreB, null);
  assert.strictEqual(masked.qualifier, null);
}

// blockSaveBets não decide mais a visibilidade do pódio: unlockedPhases decide.
assert.strictEqual(
  getGlobalPredictionVisibilityState({ blockSaveBets: false, unlockedPhases: [] }, false, false).locked,
  true
);
assert.strictEqual(
  getGlobalPredictionVisibilityState({ blockSaveBets: true, unlockedPhases: [] }, false, false).locked,
  true
);
assert.strictEqual(
  getGlobalPredictionVisibilityState({ blockSaveBets: true, unlockedPhases: ['podium'] }, false, false).locked,
  false
);
assert.deepStrictEqual(
  maskPodium(['A', 'B', 'C', 'D'], true),
  ['🔒', '🔒', '🔒', '🔒']
);
assert.deepStrictEqual(
  maskExtras({ topScorer: 'X', bestAttack: 'Y' }, true),
  { topScorer: '🔒', bestAttack: '🔒' }
);
assert.deepStrictEqual(
  maskGroupPredictions([{ group: 'A', positions: [{ position: 1, team: 'X' }] }], true),
  [{ group: 'A', positions: [{ position: 1, team: '🔒' }], additionalQualifiedTeams: [] }]
);

console.log('bet-visibility-critical: ALL TESTS PASSED');

{
  const open = { ...match, matchId: 30, status: 'scheduled', date: '02/09/2026', time: '12:00' };
  const started = { ...match, matchId: 31, status: 'in_progress', date: '02/09/2026', time: '11:00' };
  const state = getBetLockState(
    open,
    { testMode: true, betLockMode: 'grade', groupBetAvailabilityMode: 'all', lockedPhases: [] },
    new Date('2026-09-02T11:30:00Z'),
    [open, started]
  );
  assert.strictEqual(state.locked, true);
  assert.strictEqual(state.reason, 'grade_started');
}

{
  const open = { ...match, matchId: 40, status: 'scheduled', date: '02/09/2026', time: '12:00' };
  const started = { ...match, matchId: 41, status: 'in_progress', date: '02/09/2026', time: '11:00' };
  const state = getBetLockState(
    open,
    { testMode: true, betLockMode: 'match', groupBetAvailabilityMode: 'all', lockedPhases: [] },
    new Date('2026-09-02T11:30:00Z'),
    [open, started]
  );
  assert.strictEqual(state.locked, false);
}

console.log('GRADE/MATCH TESTS PASSED');
