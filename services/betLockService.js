/**
 * Centraliza as regras de bloqueio de apostas.
 *
 * Modo de bloqueio configurado pelo administrador:
 * - match (Por partida): é a definição final. Cada partida é bloqueada
 *   somente pelo próprio status/horário. A disponibilidade da fase não
 *   altera o alcance desse bloqueio.
 * - grade (Por rodada): o alcance depende da disponibilidade da fase:
 *     * round -> rodada por rodada;
 *     * all   -> fase inteira.
 *
 * blockSaveBets continua sendo uma trava global separada.
 */

const { parseMatchDateTime } = require('../utils/matchDateTime');

function parseMatchDate(dateStr, timeStr) {
  return parseMatchDateTime(dateStr, timeStr);
}

function getBetLockMode(settings) {
  return settings?.betLockMode === 'match' ? 'match' : 'grade';
}

function isMatchStarted(match, now = new Date()) {
  if (!match) return false;

  if (
    match.status &&
    !['scheduled', 'cancelled', 'postponed'].includes(
      String(match.status).toLowerCase().trim()
    )
  ) {
    return true;
  }

  const matchDate = parseMatchDate(match.date, match.time);
  return Boolean(matchDate && matchDate <= now);
}

function isMatchStartedByTime(match, now = new Date()) {
  if (!match) return false;
  const matchDate = parseMatchDate(match.date, match.time);
  return Boolean(matchDate && matchDate <= now);
}

function getMatchGrade(match) {
  if (!match) return null;
  return match.phaseName || match.group || null;
}

function getPhaseKind(match) {
  const phase = String(match?.phase || '').toLowerCase().trim();
  if (phase === 'group' || phase === 'groups' || phase === 'grupo' || phase === 'grupos') {
    return 'group';
  }
  if (phase === 'pontos_corridos' || phase === 'points_run') {
    return 'points_run';
  }
  if (phase === 'knockout' || phase === 'mata-mata' || phase === 'mata_mata') {
    return 'knockout';
  }
  return null;
}

function getAvailabilityMode(match, settings) {
  const kind = getPhaseKind(match);
  if (kind === 'group') return settings?.groupBetAvailabilityMode === 'round' ? 'round' : 'all';
  if (kind === 'points_run') return settings?.pointsRunBetAvailabilityMode === 'round' ? 'round' : 'all';
  if (kind === 'knockout') return settings?.knockoutBetAvailabilityMode === 'round' ? 'round' : 'all';
  return 'all';
}

function getRoundConfig(match, settings) {
  const kind = getPhaseKind(match);
  if (kind === 'group') {
    return {
      unlocked: Array.isArray(settings?.unlockedGroupRounds) ? settings.unlockedGroupRounds.map(Number) : [],
      locked: Array.isArray(settings?.lockedGroupRounds) ? settings.lockedGroupRounds.map(Number) : [],
      lockedField: 'lockedGroupRounds'
    };
  }
  if (kind === 'points_run') {
    return {
      unlocked: Array.isArray(settings?.unlockedPointsRunRounds) ? settings.unlockedPointsRunRounds.map(Number) : [],
      locked: Array.isArray(settings?.lockedPointsRunRounds) ? settings.lockedPointsRunRounds.map(Number) : [],
      lockedField: 'lockedPointsRunRounds'
    };
  }
  if (kind === 'knockout') {
    return {
      unlocked: Array.isArray(settings?.unlockedKnockoutRounds) ? settings.unlockedKnockoutRounds.map(Number) : [],
      locked: Array.isArray(settings?.lockedKnockoutRounds) ? settings.lockedKnockoutRounds.map(Number) : [],
      lockedField: 'lockedKnockoutRounds'
    };
  }
  return null;
}

/**
 * Retorna a configuração de alcance do bloqueio automático.
 * Isto é usado também pelo atualizador para persistir a trava no lugar certo.
 */
function getAutomaticLockTarget(match, settings) {
  const mode = getBetLockMode(settings);

  // Por partida é definitivo: nenhuma trava de fase/rodada é persistida.
  if (mode === 'match') {
    return { scope: 'match', phaseKind: getPhaseKind(match), round: null, identifier: null };
  }

  const availabilityMode = getAvailabilityMode(match, settings);
  const round = Number(match?.roundNumber);
  const grade = getMatchGrade(match);

  if (availabilityMode === 'round' && Number.isInteger(round) && round > 0) {
    return {
      scope: 'round',
      phaseKind: getPhaseKind(match),
      round,
      identifier: grade || `Rodada ${round}`
    };
  }

  return {
    scope: 'phase',
    phaseKind: getPhaseKind(match),
    round: null,
    identifier: grade
  };
}

function getGroupRoundLockState(match, settings, allMatches = [], now = new Date()) {
  const kind = getPhaseKind(match);
  if (!kind) return { applicable: false, locked: false, reason: null, scope: null };

  const availabilityMode = getAvailabilityMode(match, settings);
  if (availabilityMode !== 'round') {
    return { applicable: false, locked: false, reason: null, scope: 'phase' };
  }

  const round = Number(match?.roundNumber);
  if (!Number.isInteger(round) || round <= 0) {
    return { applicable: true, locked: true, reason: 'round_not_defined', scope: 'round' };
  }

  const config = getRoundConfig(match, settings);
  if (config.locked.includes(round)) {
    return { applicable: true, locked: true, reason: 'round_locked', scope: 'round', round };
  }

  // No modo de teste, o início/horário real não fecha automaticamente a rodada.
  // A liberação/bloqueio administrativo continua sendo respeitada.
  if (settings?.testMode !== true) {
    const roundStarted = Array.isArray(allMatches) && allMatches.some(other =>
      getPhaseKind(other) === kind &&
      Number(other?.roundNumber) === round &&
      isMatchStarted(other, now)
    );

    if (roundStarted) {
      return { applicable: true, locked: true, reason: 'round_started', scope: 'round', round };
    }
  }

  if (!config.unlocked.includes(round)) {
    return { applicable: true, locked: true, reason: 'round_not_released', scope: 'round', round };
  }

  return { applicable: true, locked: false, reason: null, scope: 'round', round };
}

function isGradeLocked(match, settings) {
  const grade = getMatchGrade(match);
  return Boolean(
    grade &&
    Array.isArray(settings?.lockedPhases) &&
    settings.lockedPhases.some(value => String(value).trim() === String(grade).trim())
  );
}

function getBetLockState(match, settings, now = new Date(), allMatches = []) {
  const mode = getBetLockMode(settings);

  // Por partida: disponibilidade da fase é irrelevante.
  if (mode === 'match') {
    // Por partida é a definição final: somente o horário da própria partida
    // encerra a aposta. O status recebido do robô/admin não cria um bloqueio
    // adicional nesse modo.
    const startedByTime = settings?.testMode === true
      ? false
      : isMatchStartedByTime(match, now);
    return {
      mode,
      scope: 'match',
      locked: startedByTime,
      reason: startedByTime ? 'match_started' : null
    };
  }

  const availabilityMode = getAvailabilityMode(match, settings);

  // Por rodada + liberação rodada por rodada.
  if (availabilityMode === 'round') {
    return {
      mode,
      ...getGroupRoundLockState(match, settings, allMatches, now)
    };
  }

  // Por rodada + liberação da fase inteira.
  // Aqui o início de qualquer partida da fase pode encerrar a fase inteira.
  const gradeLocked = isGradeLocked(match, settings);
  const grade = getMatchGrade(match);
  const phaseStarted = settings?.testMode === true
    ? false
    : Array.isArray(allMatches) && grade
      ? allMatches.some(other =>
          getMatchGrade(other) === grade &&
          isMatchStarted(other, now)
        )
      : isMatchStarted(match, now);

  return {
    mode,
    scope: 'phase',
    locked: gradeLocked || phaseStarted,
    reason: gradeLocked
      ? 'grade_locked'
      : phaseStarted
        ? 'grade_started'
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
  isMatchStartedByTime,
  getMatchGrade,
  getPhaseKind,
  getAvailabilityMode,
  getRoundConfig,
  getAutomaticLockTarget,
  isGradeLocked,
  getGroupRoundLockState,
  getBetLockState,
  isBetLocked
};
