/**
 * Centraliza as regras de bloqueio de apostas.
 *
 * Modos:
 * - grade: quando a primeira partida da grade inicia, a grade inteira fica bloqueada.
 *   lockedPhases continua sendo a trava administrativa/persistida, mas a decisão
 *   também detecta o início real de qualquer partida da mesma grade.
 * - match: cada partida é bloqueada pelo próprio status/horário.
 *
 * blockSaveBets continua sendo uma trava global separada e não pertence a este service.
 */

function parseMatchDate(dateStr, timeStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;

  let hours = 0;
  let minutes = 0;

  if (typeof timeStr === 'string' && timeStr.trim()) {
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return null;

    hours = Number(match[1]);
    minutes = Number(match[2]);

    if (
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
  }

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hours,
      minutes,
      0,
      0
    )
  );
}

function getBetLockMode(settings) {
  return settings?.betLockMode === 'match'
    ? 'match'
    : 'grade';
}

function isMatchStarted(match, now = new Date()) {
  if (!match) return false;

  if (
    match.status &&
    !['scheduled', 'cancelled', 'postponed'].includes(match.status)
  ) {
    return true;
  }

  const matchDate = parseMatchDate(match.date, match.time);

  return Boolean(
    matchDate &&
    matchDate <= now
  );
}

function getMatchGrade(match) {
  if (!match) return null;
  return match.phaseName || match.group || null;
}

function getGroupRoundLockState(match, settings) {
  const phase = String(match?.phase || '').toLowerCase();
  const isGroup = phase === 'group';
  const isPointsRun = phase === 'pontos_corridos' || phase === 'points_run';
  const isKnockout = phase === 'knockout';

  if (!isGroup && !isPointsRun && !isKnockout) {
    return { applicable: false, locked: false, reason: null };
  }

  const mode = isGroup
    ? settings?.groupBetAvailabilityMode
    : isPointsRun
      ? settings?.pointsRunBetAvailabilityMode
      : settings?.knockoutBetAvailabilityMode;

  if (mode !== 'round') {
    return { applicable: true, locked: false, reason: null };
  }

  const round = Number(match.roundNumber);
  if (!Number.isInteger(round) || round <= 0) {
    return { applicable: true, locked: true, reason: 'round_not_defined' };
  }

  const unlocked = isGroup
    ? (Array.isArray(settings?.unlockedGroupRounds) ? settings.unlockedGroupRounds.map(Number) : [])
    : isPointsRun
      ? (Array.isArray(settings?.unlockedPointsRunRounds) ? settings.unlockedPointsRunRounds.map(Number) : [])
      : (Array.isArray(settings?.unlockedKnockoutRounds) ? settings.unlockedKnockoutRounds.map(Number) : []);

  const locked = isGroup
    ? (Array.isArray(settings?.lockedGroupRounds) ? settings.lockedGroupRounds.map(Number) : [])
    : isPointsRun
      ? (Array.isArray(settings?.lockedPointsRunRounds) ? settings.lockedPointsRunRounds.map(Number) : [])
      : (Array.isArray(settings?.lockedKnockoutRounds) ? settings.lockedKnockoutRounds.map(Number) : []);

  if (locked.includes(round)) {
    return { applicable: true, locked: true, reason: 'round_locked' };
  }

  return {
    applicable: true,
    locked: !unlocked.includes(round),
    reason: !unlocked.includes(round) ? 'round_not_released' : null
  };
}

function isGradeLocked(match, settings) {
  const grade = getMatchGrade(match);

  return Boolean(
    grade &&
    Array.isArray(settings?.lockedPhases) &&
    settings.lockedPhases.includes(grade)
  );
}

/**
 * Retorna o motivo do bloqueio sem aplicar blockSaveBets.
 */
function getBetLockState(match, settings, now = new Date(), allMatches = []) {
  const mode = getBetLockMode(settings);
  const started = isMatchStarted(match, now);

  const groupRoundState = getGroupRoundLockState(match, settings);
  if (groupRoundState.applicable && groupRoundState.locked) {
    return { mode: 'group-round', locked: true, reason: groupRoundState.reason };
  }

  if (mode === 'match') {
    return {
      mode,
      locked: started,
      reason: started ? 'match_started' : null
    };
  }

  const gradeLocked = isGradeLocked(match, settings);
  const grade = getMatchGrade(match);

  // No modo grade, o primeiro jogo que iniciar fecha a grade inteira.
  // Se allMatches não foi fornecido, mantemos a trava persistida/da própria partida.
  const gradeStarted = mode === 'grade' && Array.isArray(allMatches) && grade
    ? allMatches.some(other =>
        getMatchGrade(other) === grade && isMatchStarted(other, now)
      )
    : false;

  return {
    mode,
    locked: gradeLocked || gradeStarted || started,
    reason: gradeLocked
      ? 'grade_locked'
      : gradeStarted
        ? 'grade_started'
        : (mode === 'match' && started)
          ? 'match_started'
          : null
  };
}

function isBetLocked(match, settings, now = new Date(), allMatches = []) {
  return getBetLockState(match, settings, now, allMatches).locked;
}

module.exports = {
  parseMatchDate,
  getBetLockMode,
  isMatchStarted,
  getMatchGrade,
  isGradeLocked,
  getGroupRoundLockState,
  getBetLockState,
  isBetLocked
};
