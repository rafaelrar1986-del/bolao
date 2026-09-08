'use strict';

const assert = require('assert');
const {
  getBetLockMode,
  getAvailabilityMode,
  getAutomaticLockTarget,
  getBetLockState
} = require('../services/betLockService');

const now = new Date('2026-09-08T14:00:00Z');

function groupMatch(overrides = {}) {
  return {
    matchId: 1,
    phase: 'group',
    phaseName: 'Fase de grupos',
    group: 'GRUPO A',
    roundNumber: 1,
    teamA: 'A',
    teamB: 'B',
    date: '08/09/2026',
    time: '10:00',
    status: 'scheduled',
    ...overrides
  };
}

// 1) Por partida é definição final: disponibilidade de fase não interfere.
{
  const settings = {
    betLockMode: 'match',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [1],
    lockedGroupRounds: [],
    lockedPhases: ['Fase de grupos']
  };
  assert.strictEqual(getBetLockMode(settings), 'match');
  assert.strictEqual(getAvailabilityMode(groupMatch(), settings), 'round');
  assert.strictEqual(getAutomaticLockTarget(groupMatch(), settings).scope, 'match');
  assert.strictEqual(getBetLockState(groupMatch({ time: '13:00' }), settings, now, []).locked, false);
  assert.strictEqual(getBetLockState(groupMatch({ time: '10:00' }), settings, now, []).locked, true);
  // Mesmo com status não agendado e fase administrativamente marcada,
  // o modo por partida continua dependendo apenas do horário da partida.
  assert.strictEqual(getBetLockState(groupMatch({ time: '18:00', status: '1_tempo' }), settings, now, []).locked, false);
}

// 2) Por rodada + disponibilidade rodada a rodada: só a rodada é afetada.
{
  const settings = {
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [1],
    lockedGroupRounds: [],
    lockedPhases: []
  };
  const startedRound1 = groupMatch({ matchId: 1, time: '10:00' });
  const futureRound1 = groupMatch({ matchId: 2, time: '18:00' });
  const round2 = groupMatch({ matchId: 3, roundNumber: 2, time: '18:00' });
  const all = [startedRound1, futureRound1, round2];

  assert.strictEqual(getAutomaticLockTarget(futureRound1, settings).scope, 'round');
  assert.strictEqual(getBetLockState(futureRound1, settings, now, all).locked, true);
  assert.strictEqual(getBetLockState(round2, settings, now, all).locked, true);
  assert.strictEqual(getBetLockState(round2, { ...settings, unlockedGroupRounds: [2] }, now, [round2]).locked, false);
}

// 3) Por rodada + fase inteira: o início de qualquer partida fecha a fase.
{
  const settings = {
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'all',
    unlockedGroupRounds: [],
    lockedGroupRounds: [],
    lockedPhases: []
  };
  const started = groupMatch({ matchId: 1, time: '10:00' });
  const future = groupMatch({ matchId: 2, time: '18:00' });
  const state = getBetLockState(future, settings, now, [started, future]);
  assert.strictEqual(getAutomaticLockTarget(future, settings).scope, 'phase');
  assert.strictEqual(state.locked, true);
  assert.strictEqual(state.reason, 'grade_started');
}

// 4) Trava administrativa por rodada continua tendo prioridade.
{
  const settings = {
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [1],
    lockedGroupRounds: [1],
    lockedPhases: []
  };
  const future = groupMatch({ time: '18:00' });
  const state = getBetLockState(future, settings, now, [future]);
  assert.strictEqual(state.locked, true);
  assert.strictEqual(state.reason, 'round_locked');
}

// 5) Modo de teste ignora início/horário automático, mas mantém bloqueio administrativo.
{
  const settings = {
    betLockMode: 'grade',
    groupBetAvailabilityMode: 'round',
    unlockedGroupRounds: [1],
    lockedGroupRounds: [],
    lockedPhases: [],
    testMode: true
  };
  const started = groupMatch({ time: '10:00' });
  assert.strictEqual(getBetLockState(started, settings, now, [started]).locked, false);

  const manuallyLocked = {
    ...settings,
    lockedGroupRounds: [1]
  };
  assert.strictEqual(getBetLockState(started, manuallyLocked, now, [started]).locked, true);
  assert.strictEqual(getBetLockState(started, manuallyLocked, now, [started]).reason, 'round_locked');
}

// 6) Mata-mata usa exatamente a mesma matriz.
{
  const match = {
    phase: 'knockout', phaseName: 'Oitavas de final', group: 'Oitavas de final',
    roundNumber: 1, date: '08/09/2026', time: '18:00', status: 'scheduled'
  };
  const settings = {
    betLockMode: 'grade',
    knockoutBetAvailabilityMode: 'round',
    unlockedKnockoutRounds: [1],
    lockedKnockoutRounds: []
  };
  assert.strictEqual(getAutomaticLockTarget(match, settings).scope, 'round');
  assert.strictEqual(getBetLockState(match, settings, now, [match]).locked, false);
}

console.log('PASS: bet-lock-mode-regression.test.js');
