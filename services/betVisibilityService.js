/**
 * Centraliza a regra de visibilidade dos palpites de terceiros.
 *
 * REGRAS:
 * 1) blockSaveBets controla SOMENTE salvamento. Nunca libera visibilidade.
 * 2) Enquanto a aposta ainda puder ser criada/alterada, terceiros NÃO veem o palpite.
 * 3) Depois do bloqueio real, a visibilidade depende de unlockedPhases.
 * 4) Admin e dono sempre podem ver seus dados.
 *
 * unlockedPhases é a autorização administrativa explícita para revelar uma
 * fase/rodada. O valor é dinâmico e pode ser:
 *   - group / nome do grupo / phaseName
 *   - pontos_corridos / points_run / phaseName
 *   - knockout / nome da etapa / phaseName
 *   - podium
 */

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getMatchVisibilityKeys(match) {
  if (!match) return [];

  const phase = normalizeKey(match.phase);
  const keys = new Set();

  const add = value => {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    keys.add(raw);
    keys.add(normalizeKey(raw));
  };

  if (phase === 'group' || phase === 'groups' || phase === 'grupo' || phase === 'grupos') {
    add('group');
    add(match.group);
    add(match.phaseName);
    if (Number.isInteger(Number(match.roundNumber)) && Number(match.roundNumber) > 0) {
      add(`Rodada ${Number(match.roundNumber)}`);
    }
  } else if (phase === 'pontos_corridos' || phase === 'points_run') {
    add('pontos_corridos');
    add('points_run');
    add(match.phaseName);
    if (Number.isInteger(Number(match.roundNumber)) && Number(match.roundNumber) > 0) {
      add(`Rodada ${Number(match.roundNumber)}`);
    }
  } else if (phase === 'knockout' || phase === 'mata-mata' || phase === 'mata_mata') {
    add('knockout');
    add('mata-mata');
    add(match.group);
    add(match.phaseName);
    if (Number.isInteger(Number(match.roundNumber)) && Number(match.roundNumber) > 0) {
      add(`Rodada ${Number(match.roundNumber)}`);
    }
  } else {
    add(match.phase);
    add(match.group);
    add(match.phaseName);
  }

  return [...keys];
}

function isPhaseVisibilityUnlocked(match, settings) {
  const unlocked = Array.isArray(settings?.unlockedPhases)
    ? settings.unlockedPhases
    : [];

  if (!match || unlocked.length === 0) return false;

  const unlockedSet = new Set(
    unlocked.flatMap(value => {
      const raw = String(value ?? '').trim();
      return raw ? [raw, normalizeKey(raw)] : [];
    })
  );

  return getMatchVisibilityKeys(match).some(key =>
    unlockedSet.has(key) || unlockedSet.has(normalizeKey(key))
  );
}

function getVisibilityLockState(
  match,
  settings,
  isAdmin = false,
  getBetLockState,
  isOwner = false,
  now = new Date(),
  allMatches = []
) {
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

  if (typeof getBetLockState !== 'function') {
    return {
      locked: true,
      reason: 'lock_service_unavailable',
      editable: false,
      visible: false
    };
  }

  const state = getBetLockState(match, settings, now, allMatches);
  const editable = state?.locked !== true;

  // A privacidade segue primeiro a regra de edição. unlockedPhases só
  // autoriza a revelação depois que a aposta já estiver bloqueada.
  const phaseUnlocked = isPhaseVisibilityUnlocked(match, settings);
  const visible = !editable && phaseUnlocked;

  return {
    locked: !visible,
    reason: visible
      ? null
      : editable
        ? (state?.reason || 'bet_editable')
        : (phaseUnlocked ? 'bet_visibility_locked' : 'phase_visibility_locked'),
    editable,
    visible
  };
}

function getGlobalPredictionVisibilityState(settings, isAdmin = false, isOwner = false, visibilityKey = 'podium') {
  if (isAdmin || isOwner) {
    return { locked: false, reason: null, editable: false, visible: true };
  }

  const unlocked = Array.isArray(settings?.unlockedPhases)
    ? settings.unlockedPhases.map(v => normalizeKey(v))
    : [];

  const visible = unlocked.includes(normalizeKey(visibilityKey));

  return {
    locked: !visible,
    reason: visible ? null : 'phase_visibility_locked',
    editable: !visible,
    visible
  };
}

function getVisibleBetData(bet, match, visibilityState) {
  const locked = visibilityState?.visible !== true;

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
  normalizeKey,
  getMatchVisibilityKeys,
  isPhaseVisibilityUnlocked,
  getVisibilityLockState,
  getGlobalPredictionVisibilityState,
  getVisibleBetData,
  maskGroupPredictions,
  maskPodium,
  maskExtras
};
