/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesProgress(ctx = {}) {
  const get = (name) => ctx[name];

  function updateKnockoutProgressUI() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getKnockoutGroupProgress } = ctx;
    document
      .querySelectorAll('#knockout-container .accordion-item')
      .forEach(item => {
        const groupName = item.dataset.group;
        const progress = getKnockoutGroupProgress(groupName);
        if (!progress || progress.mode === 'none') return;

        const percent = progress.total
          ? Math.round((progress.filled / progress.total) * 100)
          : 0;

        const fill = item.querySelector('.progress-fill');
        const text = item.querySelector('.progress-text');

        if (!fill || !text) return;

        fill.style.width = `${percent}%`;
        fill.className =
          progress.mode === 'games'
            ? 'progress-fill games'
            : 'progress-fill decisions';

        text.textContent = `${progress.filled} / ${progress.total}`;
      });
  }

  function formatDateBR(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    return formatMatchDateLocal(match);
  }

  function getKnockoutGroupProgress(groupKey) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasWinnerBet, hasQualifierBet, isKnockoutMatchAvailableForBetting, formatDateBR, getKnockoutConfrontationInfo } = ctx;
    const games = STATE.matches.filter(m => {
      if (!isKnockoutMatch(m)) return false;
      if (!isKnockoutMatchAvailableForBetting(m)) return false;
      if (STATE.knockoutFilter === 'date') {
        return formatDateBR(m) === groupKey;
      }
      return (m.group || 'Mata-mata') === groupKey;
    });

    if (!games.length) return { mode: 'none' };

    const validGames = games.filter(m => m.status !== 'cancelled');

    // 🆕 Respeita scoring rules: só conta decisões habilitadas pelo admin
    const totalDecisions = validGames.reduce((sum, m) => {
      let needed = hasWinnerBet() ? 1 : 0;
      const info = getKnockoutConfrontationInfo(m);
      if (hasQualifierBet(m) && info.index === 0) needed++;
      return sum + needed;
    }, 0);

    let filledDecisions = 0;
    const countedQualifierConfrontations = new Set();
    validGames.forEach(m => {
      if (hasWinnerBet() && (STATE.betsMap.has(Number(m.matchId)) || STATE.betsMap.has(String(m.matchId)))) filledDecisions++;
      const info = getKnockoutConfrontationInfo(m);
      if (hasQualifierBet(m) && info.index === 0) {
        const key = String(info.first?.matchId ?? m.matchId);
        if (!countedQualifierConfrontations.has(key)) {
          countedQualifierConfrontations.add(key);
          if (STATE.knockoutQualifiers.has(Number(key)) || STATE.knockoutQualifiers.has(key)) filledDecisions++;
        }
      }
    });

    const finished = validGames.filter(m => m.status === 'finished').length;

    let shouldShowGamesMode = false;

    if (STATE.knockoutFilter === 'date') {
      shouldShowGamesMode = validGames.every(m => 
        STATE.savedKnockoutGroups.has(m.group || 'Mata-mata')
      );
    } else {
      shouldShowGamesMode = STATE.savedKnockoutGroups.has(groupKey);
    }

    if (shouldShowGamesMode) {
      return {
        mode: 'games',
        filled: finished,
        total: validGames.length
      };
    }

    return {
      mode: 'decisions',
      filled: filledDecisions,
      total: totalDecisions
    };
  }

  function startGroupPredictionPointsLiveRefresh() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, loadGroupPredictionPointsLive } = ctx;
    clearInterval(window.__groupPredictionPointsPointsTimer);
    window.__groupPredictionPointsPointsTimer = setInterval(() => {
      loadGroupPredictionPointsLive();
    }, 30000);
  }

  function getGroupPhaseProgress(groupKey, games) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const validGames = games.filter(m => m.status !== 'cancelled');

    if (!validGames.length) {
      return { mode: 'none' };
    }

    if (!STATE.hasSubmitted) {
      const total = validGames.length;
      let filled = 0;

      validGames.forEach(m => {
        if (STATE.betsMap.has(m.matchId)) filled++;
      });

      return {
        mode: 'decisions',
        filled,
        total
      };
    }

    const finished = validGames.filter(m => m.status === 'finished').length;

    return {
      mode: 'games',
      filled: finished,
      total: validGames.length
    };
  }

  function updateGroupProgressUI() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, isGroupMatchBetFilled, isMatchAvailableForBetting } = ctx;
    document
      .querySelectorAll('#matches-container .accordion-item')
      .forEach(item => {
        const total = item.querySelectorAll('.match-card').length;
        if (!total) return;

        let filled = 0;

        if (!STATE.hasSubmitted) {
          const groupKey = item.dataset.group ||
            item.querySelector('.accordion-title')?.textContent
              .replace(/\d+\s*pts/i, '').trim();

          const games = STATE.matches.filter(m => {
            const phase = String(m.phase || '').toLowerCase();
            const isPointsRun = phase === 'pontos_corridos' || phase === 'points_run';
            const matchGroup = isPointsRun
              ? String(m.phaseName || (Number(m.roundNumber) > 0 ? `Rodada ${m.roundNumber}` : 'Pontos Corridos')).trim().toUpperCase()
              : String(m.group || '').trim().toUpperCase();
            const currentKey = (groupKey || '').trim().toUpperCase();
            return matchGroup === currentKey &&
              isMatchAvailableForBetting(m);
          });

          filled = games.filter(m => isGroupMatchBetFilled(m)).length;
        } else {
          filled = item.querySelectorAll('.match-card[data-status="finished"], .match-card.finished').length;

          if (filled === 0 && STATE.matches) {
            const groupKey = item.dataset.group || item.querySelector('.accordion-title')?.textContent.replace(/\d+\s*pts/i, '').trim();
            const games = STATE.matches.filter(m => {
              const matchGroup = (m.group || "").trim().toUpperCase();
              const currentKey = (groupKey || "").trim().toUpperCase();
              return matchGroup === currentKey && m.status === 'finished';
            });
            filled = games.length;
          }
        }

        const percent = total ? Math.round((filled / total) * 100) : 0;
        const fill = item.querySelector('.progress-fill');
        const text = item.querySelector('.progress-text');

        if (!fill || !text) return;

        fill.style.width = percent + '%';
        fill.className = STATE.hasSubmitted ? 'progress-fill games' : 'progress-fill decisions';
        text.textContent = `${filled} / ${total}`;
      });
  }

  function getMissingPodiumBets() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getPodiumSize, getPodiumPositions } = ctx;
    const rules = STATE.championshipRules || {};
    const podiumEnabled =
      rules.podiumEnabled !== false &&
      rules.podium?.enabled !== false;

    if (!podiumEnabled) return [];

    // O tamanho oficial do pódio já é centralizado em getPodiumSize().
    // Não usar fallback 4 aqui: campeonatos com 2 posições devem cobrar
    // exatamente first + second, e nunca third + fourth.
    const positions = getPodiumPositions();
    if (!positions.length) return [];

    const podium = STATE.podium || {};
    return positions.filter(position => {
      const value =
        podium[position] ??
        podium[String(position)] ??
        podium[`position${position}`];

      return value == null || String(value).trim() === '';
    });
  }

  function getMissingRequiredBetsTotal() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getMissingGroupBets, getMissingExtrasBets, getMissingPodiumBets } = ctx;
    const group = typeof getMissingGroupBets === 'function'
      ? getMissingGroupBets().length
      : 0;

    const extras = typeof getMissingExtrasBets === 'function'
      ? getMissingExtrasBets().length
      : 0;

    const podium = getMissingPodiumBets().length;

    return {
      group,
      extras,
      podium,
      total: group + extras + podium
    };
  }

  function updateBetsCounters() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, isMatchAvailableForBetting, getMissingKnockoutDecisionsCount, getMissingRequiredBetsTotal } = ctx;
    const groupsEl = document.getElementById('groups-counter');
    const knockoutEl = document.getElementById('knockout-counter');

    const missing = getMissingRequiredBetsTotal();

    // O contador de grupos representa tudo que é obrigatório antes do envio:
    // partidas disponíveis + extras + posições do pódio.
    if (groupsEl) {
      if (missing.total > 0) {
        groupsEl.textContent = `Pendentes: ${missing.total}`;
        groupsEl.style.display = 'block';
      } else {
        groupsEl.textContent = '';
        groupsEl.style.display = 'none';
      }
    }

    if (knockoutEl) {
      const checkKO =
        typeof isKnockoutMatch === 'function'
          ? isKnockoutMatch
          : (m) => m.isKnockout;

      const scheduledKnockouts = (STATE.matches || [])
        .filter(checkKO)
        .filter(m => isMatchAvailableForBetting(m));

      if (!scheduledKnockouts.length) {
        knockoutEl.textContent = '';
        knockoutEl.style.display = 'none';
      } else {
        const missingKnockout =
          typeof getMissingKnockoutDecisionsCount === 'function'
            ? getMissingKnockoutDecisionsCount()
            : 0;

        if (missingKnockout > 0) {
          knockoutEl.textContent = `Pendentes: ${missingKnockout}`;
          knockoutEl.style.display = 'block';
        } else {
          knockoutEl.textContent = '';
          knockoutEl.style.display = 'none';
        }
      }
    }
  }

  return {
    updateKnockoutProgressUI,
    formatDateBR,
    getKnockoutGroupProgress,
    startGroupPredictionPointsLiveRefresh,
    getGroupPhaseProgress,
    updateGroupProgressUI,
    getMissingPodiumBets,
    getMissingRequiredBetsTotal,
    updateBetsCounters,
  };
}
