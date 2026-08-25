/**
 * Centraliza a regra de visibilidade dos palpites de terceiros.
 *
 * Importante:
 * - Administrador sempre pode visualizar.
 * - No modo "match", a partida é liberada pelo próprio horário/status.
 * - No modo "grade", a visibilidade continua usando unlockedPhases,
 *   preservando o comportamento existente.
 * - Se a partida não for encontrada, a regra é fail-closed: fica bloqueada.
 *
 * Este módulo não contém regras de salvamento e não toca no leadership-path.
 */

function getVisibilityLockState(match, settings, isAdmin, getBetLockState) {
  if (isAdmin) {
    return {
      locked: false,
      reason: null
    };
  }

  const mode =
    settings?.betLockMode === 'match'
      ? 'match'
      : 'grade';

  if (mode === 'match') {
    if (!match) {
      return {
        locked: true,
        reason: 'match_not_found'
      };
    }

    const state =
      getBetLockState(
        match,
        settings,
        new Date()
      );

    // Para visibilidade, a lógica é o inverso da trava de salvamento:
    // antes do início o palpite fica oculto; após o início ele é revelado.
    return {
      locked: !state.locked,
      reason: state.locked
        ? null
        : 'match_not_started'
    };
  }

  const unlockedPhases =
    Array.isArray(settings?.unlockedPhases)
      ? settings.unlockedPhases
      : [];

  if (
    match?.phase === 'group' &&
    settings?.groupBetAvailabilityMode === 'round'
  ) {
    const round = Number(match.roundNumber);
    const unlockedRounds = Array.isArray(settings?.unlockedGroupRounds)
      ? settings.unlockedGroupRounds.map(Number)
      : [];
    const lockedRounds = Array.isArray(settings?.lockedGroupRounds)
      ? settings.lockedGroupRounds.map(Number)
      : [];

    if (!Number.isInteger(round) || round <= 0) {
      return { locked: true, reason: 'round_not_defined' };
    }

    if (lockedRounds.includes(round) || !unlockedRounds.includes(round)) {
      return { locked: true, reason: 'round_not_released' };
    }
  }

  if (!match) {
    return {
      locked: true,
      reason: 'match_not_found'
    };
  }

  if (
    match.phase === 'group' ||
    match.phase === 'pontos_corridos'
  ) {
    const groupUnlocked =
      unlockedPhases.includes('group');

    const specificGroupUnlocked =
      unlockedPhases.includes(match.group);

    const phaseNameUnlocked =
      unlockedPhases.includes(match.phaseName);

    const locked =
      !groupUnlocked &&
      !specificGroupUnlocked &&
      !phaseNameUnlocked;

    return {
      locked,
      reason: locked
        ? 'phase_not_unlocked'
        : null
    };
  }

  const locked =
    !unlockedPhases.includes(match.group);

  return {
    locked,
    reason: locked
      ? 'phase_not_unlocked'
      : null
  };
}

function getVisibleBetData(bet, match, visibilityState) {
  const locked =
    visibilityState?.locked !== false;

  return {
    matchId: bet?.matchId,

    scoreA:
      locked
        ? null
        : bet?.scoreA,

    scoreB:
      locked
        ? null
        : bet?.scoreB,

    choice:
      locked
        ? '🔒'
        : bet?.winner,

    choiceLabel:
      locked
        ? 'Bloqueado'
        : null,

    qualifier:
      locked
        ? null
        : bet?.qualifier
  };
}

module.exports = {
  getVisibilityLockState,
  getVisibleBetData
};
