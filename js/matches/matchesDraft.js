/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesDraft(ctx = {}) {
  const get = (name) => ctx[name];

  function getDraftStorageKey() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId') || 'default';
    const user = window.currentUser || {};
    const userId = user._id || user.id || user.email || 'anonymous';
    return `bolao:draft:${String(leagueId)}:${String(userId)}`;
  }

  function saveLocalDraft() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getDraftStorageKey, buildSavePayload } = ctx;
    try {
      const payload = buildSavePayload();
      localStorage.setItem(getDraftStorageKey(), JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        payload
      }));
      return true;
    } catch (error) {
      console.error('Erro ao salvar rascunho local:', error);
      return false;
    }
  }

  function clearLocalDraft() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getDraftStorageKey } = ctx;
    try {
      localStorage.removeItem(getDraftStorageKey());
    } catch (error) {
      console.warn('Não foi possível limpar o rascunho local:', error);
    }
  }

  function applyLocalDraftPayload(payload) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    if (!payload || typeof payload !== 'object') return;

    if (payload.groupPredictions && Array.isArray(payload.groupPredictions)) {
      STATE.groupPredictions.clear();
      payload.groupPredictions.forEach(prediction => {
        const group = String(prediction.group || '').trim();
        if (!group) return;
        STATE.groupPredictions.set(group, {
          group,
          positions: Array.isArray(prediction.positions) ? prediction.positions.map(p => ({
            position: Number(p.position),
            team: String(p.team || '').trim()
          })).filter(p => Number.isInteger(p.position) && p.team) : [],
          additionalQualifiedTeams: Array.isArray(prediction.additionalQualifiedTeams)
            ? [...new Set(prediction.additionalQualifiedTeams.map(t => String(t).trim()).filter(Boolean))]
            : []
        });
      });
    }

    if (payload.groupMatches && typeof payload.groupMatches === 'object') {
      Object.entries(payload.groupMatches).forEach(([matchId, bet]) => {
        const id = Number(matchId);
        if (!Number.isFinite(id) || !bet) return;

        if (bet.winner) {
          STATE.betsMap.set(id, bet.winner);
          STATE.betsMap.set(String(matchId), bet.winner);
        }
        if (bet.scoreA != null || bet.scoreB != null) {
          const score = { scoreA: bet.scoreA ?? null, scoreB: bet.scoreB ?? null };
          STATE.scoresMap.set(id, score);
          STATE.scoresMap.set(String(matchId), score);
        }
        if (bet.qualifier === 'A' || bet.qualifier === 'B') {
          STATE.knockoutQualifiers.set(id, bet.qualifier);
        }
      });
    }

    if (Array.isArray(payload.podium)) {
      STATE.podium = {
        first: payload.podium[0] || '',
        second: payload.podium[1] || '',
        third: payload.podium[2] || '',
        fourth: payload.podium[3] || ''
      };
    }

    if (payload.extras && typeof payload.extras === 'object') {
      Object.assign(STATE.extras, payload.extras);
    }
  }

  function loadLocalDraft() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getDraftStorageKey, applyLocalDraftPayload } = ctx;
    try {
      const raw = localStorage.getItem(getDraftStorageKey());
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      // Rascunhos antigos podem conter a classificação automática alfabética.
      // Mantemos partidas/placares, mas não restauramos groupPredictions antigos.
      const payload = parsed?.payload || parsed;
      if (payload && Array.isArray(payload.groupPredictions) && parsed?.version !== 2) {
        delete payload.groupPredictions;
      }
      applyLocalDraftPayload(payload);
      return true;
    } catch (error) {
      console.warn('Não foi possível carregar o rascunho local:', error);
      return false;
    }
  }

  function buildSavePayload() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, winnerDerivesFromScore, deriveWinnerFromScoreData, hasPodium, hasTopScorer, hasBestAttack, hasWorstDefense, hasUpset, getPodiumPositions, getGroupTeams, calculatePredictedGroupStandings, getSavedGroupPrediction, getKnockoutConfrontationInfo } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId');
    const groupMatches = {};

    // 🆕 CORREÇÃO CRÍTICA: inclui qualifier dentro de groupMatches,
    // pois o backend espera groupMatches[matchId].qualifier
    STATE.betsMap.forEach((v, k) => {
      const score = STATE.scoresMap.get(k) || STATE.scoresMap.get(Number(k));
      const match = STATE.matches.find(m => Number(m.matchId) === Number(k));
      const info = match ? getKnockoutConfrontationInfo(match) : { index: 0 };
      const qualifier = info.index === 0
        ? (STATE.knockoutQualifiers.get(k) || STATE.knockoutQualifiers.get(Number(k)) || null)
        : null;
      const payloadWinner = winnerDerivesFromScore()
        ? deriveWinnerFromScoreData(score)
        : v;
      groupMatches[String(k)] = {
        winner: payloadWinner,
        scoreA: score?.scoreA ?? null,
        scoreB: score?.scoreB ?? null,
        ...(info.index === 0 ? { qualifier } : {})
      };
    });

    // 🆕 Também inclui matches de mata-mata que só têm qualifier (sem winner)
    STATE.knockoutQualifiers.forEach((v, k) => {
      const key = String(k);
      const match = STATE.matches.find(m => Number(m.matchId) === Number(k));
      const info = match ? getKnockoutConfrontationInfo(match) : { index: 0 };
      if (info.index !== 0) return;
      if (!groupMatches[key]) {
        groupMatches[key] = {
          winner: null,
          scoreA: null,
          scoreB: null,
          qualifier: v
        };
      }
    });

    // 🆕 Converte pódio do formato objeto para array conforme podiumSize dinâmico
    // Só envia se houver pelo menos uma posição com pontuação > 0
    let podiumArray = undefined;
    if (hasPodium() && STATE.podium) {
      const positions = getPodiumPositions(); // ['first', 'second', ...] conforme podiumSize
      const p = STATE.podium;
      podiumArray = positions
        .map(pos => p[pos] || '')
        .filter(t => t && t.trim() !== '');
      if (podiumArray.length === 0) podiumArray = undefined;
    }

    // 🆕 Só envia cada extra se a pontuação daquela categoria for > 0
    const extras = {};
    if (hasTopScorer()    && STATE.extras?.topScorer)    extras.topScorer    = STATE.extras.topScorer;
    if (hasBestAttack()   && STATE.extras?.bestAttack)   extras.bestAttack   = STATE.extras.bestAttack;
    if (hasWorstDefense() && STATE.extras?.worstDefense) extras.worstDefense = STATE.extras.worstDefense;
    if (hasUpset()        && STATE.extras?.upset)        extras.upset        = STATE.extras.upset;

    const payload = {
      leagueId,
      groupMatches
    };

    // 🆕 Sempre envia pódio (mesmo vazio = []), para permitir limpar no backend
    payload.podium = podiumArray || [];
    if (Object.keys(extras).length > 0) payload.extras = extras;
    /*
     * A classificação prevista é derivada das apostas das partidas.
     * Ela não pode depender somente de STATE.groupPredictions, porque esse
     * Map fica reservado para alterações manuais do usuário.
     *
     * Ao salvar, materializamos a previsão de TODOS os grupos da fase de
     * grupos. Assim, um campeonato com 12 grupos salva 12 tabelas no Bet,
     * inclusive os grupos cuja tabela nunca foi aberta pelo usuário.
     */
    const groupGamesMap = new Map();
    (STATE.matches || [])
      .filter(m => !isKnockoutMatch(m) && String(m.phase || '').toLowerCase() === 'group')
      .forEach(m => {
        const group = String(m.group || '').trim();
        if (group) {
          if (!groupGamesMap.has(group)) groupGamesMap.set(group, []);
          groupGamesMap.get(group).push(m);
        }
      });

    const groupPredictionsToSave = [];
    groupGamesMap.forEach((games, group) => {
      const teams = getGroupTeams(games);
      if (!teams.length) return;

      const standings = calculatePredictedGroupStandings(games);
      const prediction = getSavedGroupPrediction(group, standings, games);

      const positions = (prediction?.positions || []).map(p => ({
        position: Number(p.position),
        team: String(p.team || '').trim()
      })).filter(p => Number.isInteger(p.position) && p.position > 0 && p.team);

      if (!positions.length) return;

      const additionalQualifiedTeams = [
        ...new Set(
          (prediction?.additionalQualifiedTeams || [])
            .map(t => String(t || '').trim())
            .filter(Boolean)
        )
      ];

      groupPredictionsToSave.push({
        group,
        positions,
        additionalQualifiedTeams
      });
    });

    // Fallback para compatibilidade com dados antigos/estruturas sem STATE.matches.
    if (!groupPredictionsToSave.length) {
      Array.from(STATE.groupPredictions.values()).forEach(prediction => {
        const positions = (prediction?.positions || []).map(p => ({
          position: Number(p.position),
          team: String(p.team || '').trim()
        })).filter(p => Number.isInteger(p.position) && p.position > 0 && p.team);

        if (prediction?.group && positions.length) {
          groupPredictionsToSave.push({
            group: String(prediction.group).trim(),
            positions,
            additionalQualifiedTeams: [
              ...new Set(
                (prediction.additionalQualifiedTeams || [])
                  .map(t => String(t || '').trim())
                  .filter(Boolean)
              )
            ]
          });
        }
      });
    }

    payload.groupPredictions = groupPredictionsToSave;
    return payload;
  }

  return {
    getDraftStorageKey,
    saveLocalDraft,
    clearLocalDraft,
    applyLocalDraftPayload,
    loadLocalDraft,
    buildSavePayload,
  };
}
