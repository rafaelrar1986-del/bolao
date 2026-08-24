'use strict';

// Fase 1 da refatoração de matches.js.
// Região extraída sem alteração de regras de negócio.

function parseMatchDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
}

function parseMatchTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':');
  if (h == null || m == null) return 0;
  return (Number(h) * 60 + Number(m)) * 60 * 1000;
}

function getMatchTimestamp(dateStr, timeStr) {
  const d = parseMatchDate(dateStr);
  if (!d) return null;
  return d.getTime() + parseMatchTime(timeStr);
}

function compareMatchesChronologically(a, b) {
  const tsA = getMatchTimestamp(a?.date, a?.time);
  const tsB = getMatchTimestamp(b?.date, b?.time);

  if (tsA == null && tsB == null) return 0;
  if (tsA == null) return 1;
  if (tsB == null) return -1;

  return tsA - tsB;
}

function isValidMatchDate(dateStr) {
  if (typeof dateStr !== 'string') return false;

  const value = dateStr.trim();
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidMatchTime(timeStr) {
  if (typeof timeStr !== 'string') return false;

  const value = timeStr.trim();
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

const VALID_MATCH_PHASES = new Set([
  'group',
  'knockout',
  'pontos_corridos'
]);

function isKnockoutPhase(phase) {
  return phase === 'knockout';
}

function toOptionalNonNegativeInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return { value: null };
  }

  const n = Number(value);

  if (!Number.isInteger(n) || n < 0) {
    return {
      error: `${fieldName} deve conter um número inteiro não negativo.`
    };
  }

  return { value: n };
}

function validatePhaseSpecificData({
  phase,
  scoreA,
  scoreB,
  penaltiesA,
  penaltiesB,
  regularTimeScoreA,
  regularTimeScoreB,
  qualifiedSide,
  requireRegularTime = false
}) {
  if (!VALID_MATCH_PHASES.has(phase)) {
    return { error: 'phase inválida. Use "group", "knockout" ou "pontos_corridos".' };
  }

  const scoreAResult = toOptionalNonNegativeInteger(scoreA, 'scoreA');
  const scoreBResult = toOptionalNonNegativeInteger(scoreB, 'scoreB');
  const penaltiesAResult = toOptionalNonNegativeInteger(penaltiesA, 'penaltiesA');
  const penaltiesBResult = toOptionalNonNegativeInteger(penaltiesB, 'penaltiesB');
  const regularAResult = toOptionalNonNegativeInteger(
    regularTimeScoreA,
    'regularTimeScoreA'
  );
  const regularBResult = toOptionalNonNegativeInteger(
    regularTimeScoreB,
    'regularTimeScoreB'
  );

  const firstError = [
    scoreAResult,
    scoreBResult,
    penaltiesAResult,
    penaltiesBResult,
    regularAResult,
    regularBResult
  ].find(result => result.error);

  if (firstError) return { error: firstError.error };

  const normalizedQualifiedSide =
    qualifiedSide === undefined || qualifiedSide === null || qualifiedSide === ''
      ? null
      : String(qualifiedSide).trim();

  if (normalizedQualifiedSide !== null &&
      !['A', 'B'].includes(normalizedQualifiedSide)) {
    return { error: 'qualifiedSide deve ser "A", "B" ou nulo.' };
  }

  const isKnockout = isKnockoutPhase(phase);

  if (!isKnockout) {
    if (regularAResult.value !== null || regularBResult.value !== null) {
      return {
        error: 'Partidas que não são de mata-mata não possuem placar dos 90 minutos separado.'
      };
    }

    if (penaltiesAResult.value !== null || penaltiesBResult.value !== null) {
      return {
        error: 'Partidas que não são de mata-mata não podem ter pênaltis.'
      };
    }

    if (normalizedQualifiedSide !== null) {
      return {
        error: 'Partidas que não são de mata-mata não possuem classificado.'
      };
    }
  } else {
    if (
      (penaltiesAResult.value === null) !==
      (penaltiesBResult.value === null)
    ) {
      return {
        error: 'Informe os dois placares de pênaltis ou deixe ambos vazios.'
      };
    }

    if (
      penaltiesAResult.value !== null &&
      penaltiesBResult.value !== null &&
      penaltiesAResult.value === penaltiesBResult.value
    ) {
      return {
        error: 'O placar de pênaltis precisa indicar um vencedor.'
      };
    }

    if (
      requireRegularTime &&
      (regularAResult.value === null || regularBResult.value === null)
    ) {
      return {
        error: 'Para partidas de mata-mata finalizadas, informe o placar dos 90 minutos.'
      };
    }
  }

  return {
    value: {
      scoreA: scoreAResult.value,
      scoreB: scoreBResult.value,
      penaltiesA: penaltiesAResult.value,
      penaltiesB: penaltiesBResult.value,
      regularTimeScoreA: regularAResult.value,
      regularTimeScoreB: regularBResult.value,
      qualifiedSide: normalizedQualifiedSide
    }
  };
}

// 🆕 CORREÇÃO: Usa != null em vez de truthy check para aceitar leagueId = 0
function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

// ==========================================
// 1. GET /api/matches/leagues (Ligas Disponíveis)
// ==========================================

module.exports = {
  VALID_MATCH_PHASES,
  parseMatchDate,
  parseMatchTime,
  getMatchTimestamp,
  compareMatchesChronologically,
  isValidMatchDate,
  isValidMatchTime,
  isKnockoutPhase,
  toOptionalNonNegativeInteger,
  validatePhaseSpecificData,
  toLeagueId
};
