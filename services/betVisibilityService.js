/**
 * Centraliza a regra de visibilidade dos palpites de terceiros.
 *
 * Regra de negócio:
 * - O próprio usuário sempre pode ver os próprios palpites.
 * - Admin sempre pode visualizar palpites de terceiros.
 * - Para um participante comum, o palpite de uma partida fica privado
 *   enquanto aquela aposta ainda puder ser criada/alterada.
 * - Assim que a aposta fica efetivamente bloqueada para edição, ela passa
 *   a ser pública.
 *
 * A decisão de edição vem do betLockService. Não usamos unlockedPhases
 * diretamente para decidir privacidade, porque liberar uma rodada/fase para
 * aposta NÃO significa revelar os palpites existentes nela.
 */

function getVisibilityLockState(match, settings, isAdmin = false, getBetLockState, isOwner = false, now = new Date()) {
  if (isAdmin || isOwner) {
    return {
      locked: false,
      reason: null,
      editable: false,
      visible: true
    };
  }

  if (!match) {
    return {
      locked: true,
      reason: 'match_not_found',
      editable: false,
      visible: false
    };
  }

  // A trava global de salvamento também encerra a capacidade de edição.
  // O endpoint de save a aplica antes da validação da partida. Em testMode
  // essa trava é deliberadamente ignorada, portanto não altera a privacidade.
  if (settings?.blockSaveBets === true && settings?.testMode !== true) {
    return {
      locked: false,
      reason: null,
      editable: false,
      visible: true
    };
  }

  if (typeof getBetLockState !== 'function') {
    // Fail closed: sem a autoridade de lock, nunca revelamos a aposta.
    return {
      locked: true,
      reason: 'lock_service_unavailable',
      editable: false,
      visible: false
    };
  }

  const state = getBetLockState(match, settings, now);
  const editable = state?.locked !== true;

  return {
    // Privacidade é exatamente o inverso da possibilidade de edição.
    locked: editable,
    reason: editable ? (state?.reason || 'bet_editable') : null,
    editable,
    visible: !editable
  };
}

/**
 * Pódio, Extras e previsões de classificação não estão vinculados a uma
 * partida individual. O endpoint de salvamento atualmente permite alterá-los
 * enquanto a trava global de apostas não estiver ativa (e também no testMode).
 * Portanto a privacidade desses blocos acompanha a mesma autoridade de save.
 */
function getGlobalPredictionVisibilityState(settings, isAdmin = false, isOwner = false) {
  if (isAdmin || isOwner) {
    return { locked: false, reason: null, editable: false, visible: true };
  }

  const editable = settings?.testMode === true || settings?.blockSaveBets !== true;

  return {
    locked: editable,
    reason: editable ? 'global_predictions_editable' : null,
    editable,
    visible: !editable
  };
}

function getVisibleBetData(bet, match, visibilityState) {
  const locked = visibilityState?.locked !== false;

  return {
    matchId: bet?.matchId,
    isLocked: locked,
    isEditable: visibilityState?.editable === true,

    scoreA: locked ? null : bet?.scoreA,
    scoreB: locked ? null : bet?.scoreB,

    choice: locked ? '🔒' : bet?.winner,
    choiceLabel: locked ? 'Bloqueado' : null,

    qualifier: locked ? null : bet?.qualifier
  };
}

function maskGroupPredictions(groupPredictions, locked) {
  if (!locked || !Array.isArray(groupPredictions)) {
    return Array.isArray(groupPredictions) ? groupPredictions : [];
  }

  return groupPredictions.map(prediction => ({
    group: prediction?.group || '',
    positions: Array.isArray(prediction?.positions)
      ? prediction.positions.map(p => ({
          position: Number(p?.position),
          team: '🔒'
        }))
      : [],
    additionalQualifiedTeams: Array.isArray(prediction?.additionalQualifiedTeams)
      ? prediction.additionalQualifiedTeams.map(() => '🔒')
      : []
  }));
}

function maskPodium(podium, locked) {
  if (!Array.isArray(podium) || podium.length === 0) return null;
  return locked ? podium.map(() => '🔒') : podium;
}

function maskExtras(extras, locked) {
  if (!extras || typeof extras !== 'object') return null;
  if (!locked) return extras;

  return Object.fromEntries(
    Object.keys(extras).map(key => [key, '🔒'])
  );
}

module.exports = {
  getVisibilityLockState,
  getGlobalPredictionVisibilityState,
  getVisibleBetData,
  maskGroupPredictions,
  maskPodium,
  maskExtras
};
