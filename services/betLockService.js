/**
 * Centraliza as regras de bloqueio de apostas.
 *
 * Modos:
 * - grade: o início/encerramento da grade é controlado por lockedPhases.
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
function getBetLockState(match, settings, now = new Date()) {
  // 🧪 Modo de teste: permite apostar inclusive em partidas finalizadas,
  // sem alterar o status oficial da partida.
  if (settings?.testMode === true) {
    return {
      mode: 'test',
      locked: false,
      reason: null
    };
  }

  const mode = getBetLockMode(settings);
  const started = isMatchStarted(match, now);

  if (mode === 'match') {
    return {
      mode,
      locked: started,
      reason: started ? 'match_started' : null
    };
  }

  const gradeLocked = isGradeLocked(match, settings);

  return {
    mode,
    locked: gradeLocked || started,
    reason: gradeLocked
      ? 'grade_locked'
      : started
        ? 'match_started'
        : null
  };
}

function isBetLocked(match, settings, now = new Date()) {
  return getBetLockState(match, settings, now).locked;
}

module.exports = {
  parseMatchDate,
  getBetLockMode,
  isMatchStarted,
  getMatchGrade,
  isGradeLocked,
  getBetLockState,
  isBetLocked
};
