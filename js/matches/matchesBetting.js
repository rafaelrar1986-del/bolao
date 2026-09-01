/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesBetting(ctx = {}) {
  const get = (name) => ctx[name];

  function isGroupMatchBetFilled(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasCustomMatchRules, hasScoreInput, hasWinnerBet } = ctx;
    const id = Number(match?.matchId);
    const rawId = String(match?.matchId);
    const winnerFilled = STATE.betsMap.has(id) || STATE.betsMap.has(rawId);
    const score = STATE.scoresMap.get(id) || STATE.scoresMap.get(rawId);
    const scoreFilled = score?.scoreA != null && score?.scoreB != null;

    if (hasCustomMatchRules()) {
      const winnerNeeded = hasWinnerBet();
      const scoreNeeded = hasScoreInput();

      if (!winnerNeeded && !scoreNeeded) return true;
      return (winnerNeeded && winnerFilled) || (scoreNeeded && scoreFilled);
    }

    return winnerFilled || (hasScoreInput() && scoreFilled);
  }

  function getMissingGroupQualificationBets() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupQualificationConfig, getGroupTeams } = ctx;
    const rules = STATE.scoringRules?.groupQualificationRules;
    if (!Array.isArray(rules) || rules.length === 0) return [];

    const groupGames = {};
    (STATE.matches || [])
      .filter(m => !isKnockoutMatch(m) && String(m.phase || '').toLowerCase() === 'group')
      .forEach(m => {
        const group = String(m.group || '').trim();
        if (group) (groupGames[group] ||= []).push(m);
      });

    const config = getGroupQualificationConfig();
    const missing = [];

    Object.entries(groupGames).forEach(([group, games]) => {
      const prediction = STATE.groupPredictions.get(group);
      const teamCount = getGroupTeams(games).length;
      const positions = prediction?.positions || [];
      const filledPositions = new Set(
        positions.filter(p => p?.team).map(p => Number(p.position))
      );

      if (filledPositions.size < teamCount) {
        missing.push({ group, type: 'positions' });
        return;
      }

      if (config.additionalQualifiedCount > 0) {
        const selected = new Set(prediction?.additionalQualifiedTeams || []);
        if (selected.size < config.additionalQualifiedCount) {
          missing.push({ group, type: 'additionalQualified' });
        }
      }
    });

    return missing;
  }

  function getMissingGroupBets() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, isGroupMatchBetFilled, isMatchAvailableForBetting } = ctx;
    return STATE.matches
      .filter(m => isMatchAvailableForBetting(m))
      .filter(m => !isGroupMatchBetFilled(m));
  }

  function isMatchStartedByStatus(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    if (!match) return false;
    const status = String(match.status || '').toLowerCase().trim();

    // Mantém exatamente a mesma convenção do betLockService.js.
    return Boolean(
      status &&
      !['scheduled', 'cancelled', 'postponed'].includes(status)
    );
  }

  function isMatchStartedByTime(match, now = new Date()) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const matchDate = parseMatchDate(match);
    if (!matchDate || isNaN(matchDate.getTime())) return false;

    return matchDate.getTime() <= now.getTime();
  }

  function isMatchAvailableForBetting(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, isMatchStartedByStatus, isMatchStartedByTime } = ctx;
    if (!match || isKnockoutMatch(match)) return false;
    if (match.status === 'cancelled') return false;
    if (isMatchStartedByStatus(match) || isMatchStartedByTime(match)) return false;

    const phase = String(match.phase || '').toLowerCase();
    const isGroup = phase === 'group';
    const isPointsRun = phase === 'pontos_corridos' || phase === 'points_run';

    if (isGroup && STATE.groupBetAvailabilityMode === 'round') {
      const round = Number(match.roundNumber);
      if (!Number.isInteger(round) || round <= 0) return false;
      return STATE.unlockedGroupRounds.has(round) &&
             !STATE.lockedGroupRounds.has(round);
    }

    if (isPointsRun && STATE.pointsRunBetAvailabilityMode === 'round') {
      const round = Number(match.roundNumber);
      if (!Number.isInteger(round) || round <= 0) return false;
      return STATE.unlockedPointsRunRounds.has(round) &&
             !STATE.lockedPointsRunRounds.has(round);
    }

    return true;
  }

  function isKnockoutMatchAvailableForBetting(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, isMatchStartedByStatus, isMatchStartedByTime } = ctx;
    if (!match || !isKnockoutMatch(match)) return false;
    if (match.status === 'cancelled') return false;
    if (isMatchStartedByStatus(match) || isMatchStartedByTime(match)) return false;

    if (STATE.knockoutBetAvailabilityMode !== 'round') return true;

    const round = Number(match.roundNumber);
    if (!Number.isInteger(round) || round <= 0) return false;

    return STATE.unlockedKnockoutRounds.has(round) &&
           !STATE.lockedKnockoutRounds.has(round);
  }

  function isMatchEditable(match, now = new Date()) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, isMatchStartedByStatus, isMatchStartedByTime, isMatchAvailableForBetting } = ctx;
    if (!match) return false;

    // 🧪 testMode não cancela o bloqueio por início. Ele permite testar
    // o fluxo sem depender do bloqueio global, mas respeita blockMode.

    // Mantém a mesma regra temporal do backend:
    // status não agendado (exceto cancelado/postergado) OU
    // horário da partida já alcançado => bloqueada.
    const startedByStatus = isMatchStartedByStatus(match);
    const startedByTime = isMatchStartedByTime(match, now);

    if (startedByStatus || startedByTime) {
      return false;
    }

    // No modo por grade, o primeiro jogo iniciado bloqueia TODOS os jogos
    // que pertencem à mesma grade. Essa verificação vem ANTES das regras
    // de rodada para impedir que uma rodada ainda liberada continue editável.
    const lockMode = STATE.betLockMode || 'grade';
    const gradeDaPartida = match.phaseName || match.group || 'Mata-mata';
    const gradeJaIniciou = lockMode === 'grade' && STATE.matches.some(other =>
      (other.phaseName || other.group || 'Mata-mata') === gradeDaPartida &&
      (isMatchStartedByStatus(other) || isMatchStartedByTime(other, now))
    );
    if (gradeJaIniciou) return false;

    const matchPhase = String(match.phase || '').toLowerCase();

    if (match.phase === 'group' && STATE.groupBetAvailabilityMode === 'round') {
      return isMatchAvailableForBetting(match);
    }

    // No modo por partida, o horário/status da própria partida é a regra.
    if (lockMode === 'match') {
      return true;
    }
    const isPointsRun =
      matchPhase === 'pontos_corridos' || matchPhase === 'points_run';
    if (isPointsRun && STATE.pointsRunBetAvailabilityMode === 'round') {
      return isMatchAvailableForBetting(match);
    }
    if (matchPhase === 'knockout' && STATE.knockoutBetAvailabilityMode === 'round') {
      const round = Number(match.roundNumber);
      if (!Number.isInteger(round) || round <= 0) return false;
      if (STATE.lockedKnockoutRounds.has(round)) return false;
      if (!STATE.unlockedKnockoutRounds.has(round)) return false;
      return true;
    }

    return !STATE.lockedPhases?.has(gradeDaPartida);
  }

  function getMissingExtrasBets() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, hasExtras } = ctx;
    if (!hasExtras()) return [];

    const missing = [];
    const enabledExtras = [
      { key: 'topScorer', label: 'Artilheiro' },
      { key: 'bestAttack', label: 'Melhor Ataque' },
      { key: 'worstDefense', label: 'Pior Defesa' },
      { key: 'upset', label: 'Zebra' }
    ].filter(extra => Number(getScoringRules()[extra.key]) > 0);

    enabledExtras.forEach(({ key, label }) => {
      const value = STATE.extras?.[key];
      if (value == null || String(value).trim() === '') {
        missing.push({ key, label });
      }
    });

    return missing;
  }

  function getMissingKnockoutQualifiers() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasWinnerBet, hasQualifierBet, getChampionshipRules, isKnockoutMatchAvailableForBetting, getKnockoutConfrontationInfo } = ctx;
    const seenConfrontations = new Set();
    return STATE.matches
      .filter(m => isKnockoutMatchAvailableForBetting(m))
      .filter(m => {
        const info = getKnockoutConfrontationInfo(m);
        const isReturnLeg = (m?.stageFormat === 'home_away' || (getChampionshipRules()?.knockoutFormat === 'home_away' && m?.stageFormat !== 'single')) && info.index > 0;
        const id = Number(m.matchId);
        const rawId = String(m.matchId);
        const missingWinner = hasWinnerBet() && !STATE.betsMap.has(id) && !STATE.betsMap.has(rawId);
        let missingQualifier = false;
        if (hasQualifierBet(m) && !isReturnLeg) {
          const key = String(info.first?.matchId ?? id);
          if (!seenConfrontations.has(key)) {
            seenConfrontations.add(key);
            missingQualifier = !STATE.knockoutQualifiers.has(Number(key)) && !STATE.knockoutQualifiers.has(key);
          }
        }
        return missingWinner || missingQualifier;
      });
  }

  function getKnockoutGroupByMatchId(matchId) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const m = STATE.matches.find(
      m => String(m.matchId) === String(matchId)
    );
    return m?.group || null;
  }

  function getMissingKnockoutDecisionsCount() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasWinnerBet, hasQualifierBet, getChampionshipRules, isKnockoutMatchAvailableForBetting, getKnockoutConfrontationInfo } = ctx;
    const seenConfrontations = new Set();
    return STATE.matches
      .filter(m => isKnockoutMatchAvailableForBetting(m))
      .reduce((sum, m) => {
        const id = Number(m.matchId);
        const rawId = String(m.matchId);
        let missing = 0;

        if (hasWinnerBet() && !STATE.betsMap.has(id) && !STATE.betsMap.has(rawId)) missing++;

        const info = getKnockoutConfrontationInfo(m);
        const isReturnLeg = (m?.stageFormat === 'home_away' || (getChampionshipRules()?.knockoutFormat === 'home_away' && m?.stageFormat !== 'single')) && info.index > 0;
        if (hasQualifierBet(m) && !isReturnLeg) {
          const key = String(info.first?.matchId ?? id);
          if (!seenConfrontations.has(key)) {
            seenConfrontations.add(key);
            if (!STATE.knockoutQualifiers.has(Number(key)) && !STATE.knockoutQualifiers.has(key)) missing++;
          }
        }
        return sum + missing;
      }, 0);
  }

  function markKnockoutGroupAsSaved(groupName) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    STATE.savedKnockoutGroups.add(groupName);
  }

  return {
    isGroupMatchBetFilled,
    getMissingGroupQualificationBets,
    getMissingGroupBets,
    isMatchStartedByStatus,
    isMatchStartedByTime,
    isMatchAvailableForBetting,
    isKnockoutMatchAvailableForBetting,
    isMatchEditable,
    getMissingExtrasBets,
    getMissingKnockoutQualifiers,
    getKnockoutGroupByMatchId,
    getMissingKnockoutDecisionsCount,
    markKnockoutGroupAsSaved,
  };
}
