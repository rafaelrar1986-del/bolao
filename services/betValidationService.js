/**
 * Regras de validação e normalização de palpites.
 *
 * Este módulo não decide se uma aposta está bloqueada.
 * Isso continua em betLockService.js.
 *
 * Também não contém nenhuma regra do leadership-path.
 */

function scoresAreEnabled(scoringRules = {}) {
  /*
   * Quando o campeonato usa o novo criador de regras, a necessidade de
   * placar vem das condições efetivamente configuradas.
   *
   * Estas condições precisam de scoreA/scoreB:
   *   exactScore, scoreTeamA, scoreTeamB, scoreWinner, scoreLoser,
   *   totalGoals, goalDifference
   *
   * Estas NÃO precisam de placar:
   *   result, qualifier
   *
   * Se não houver matchRules, preservamos a compatibilidade com o modelo
   * antigo baseado nos campos exactScore/scoreTeamA/scoreTeamB.
   */
  if (Array.isArray(scoringRules.matchRules)) {
    const scoreConditions = new Set([
      'exactScore',
      'scoreTeamA',
      'scoreTeamB',
      'scoreWinner',
      'scoreLoser',
      'totalGoals',
      'goalDifference'
    ]);

    return scoringRules.matchRules.some(rule =>
      Array.isArray(rule?.conditions) &&
      rule.conditions.some(condition => scoreConditions.has(condition)) &&
      Number(rule?.points) > 0
    );
  }

  return (
    (Number(scoringRules.exactScore) || 0) > 0 ||
    (Number(scoringRules.scoreTeamA) || 0) > 0 ||
    (Number(scoringRules.scoreTeamB) || 0) > 0
  );
}

function isValidScoreValue(value) {
  if (value == null || value === '') return true;

  const n = Number(value);

  return (
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n >= 0
  );
}

function isValidMatchIdValue(value) {
  if (value == null || value === '') return false;

  const text = String(value).trim();

  return (
    /^\d+$/.test(text) &&
    Number(text) > 0 &&
    Number.isSafeInteger(Number(text))
  );
}

function winnerFromScores(scoreA, scoreB) {
  const a = Number(scoreA);
  const b = Number(scoreB);

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }

  if (a > b) return 'A';
  if (b > a) return 'B';

  return 'draw';
}

function isValidWinner(value) {
  return ['A', 'B', 'draw'].includes(value);
}

function normalizeQualifier(value) {
  return value === 'A' || value === 'B'
    ? value
    : null;
}

function validateWinnerAgainstScore(winner, scoreA, scoreB) {
  const derivedWinner = winnerFromScores(scoreA, scoreB);

  if (!derivedWinner) {
    return {
      valid: false,
      derivedWinner: null,
      message: 'Não foi possível derivar o vencedor pelo placar informado.'
    };
  }

  if (winner != null && winner !== '' && winner !== derivedWinner) {
    return {
      valid: false,
      derivedWinner,
      message: 'Palpite inconsistente: o vencedor não corresponde ao placar informado.'
    };
  }

  return {
    valid: true,
    derivedWinner,
    message: null
  };
}

module.exports = {
  scoresAreEnabled,
  isValidScoreValue,
  isValidMatchIdValue,
  winnerFromScores,
  isValidWinner,
  normalizeQualifier,
  validateWinnerAgainstScore
};
