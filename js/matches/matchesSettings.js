/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesSettings(ctx = {}) {
  const get = (name) => ctx[name];

  async function loadScoringRules() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, loadGlobalSettings } = ctx;
    await loadGlobalSettings();
  }

  async function loadGlobalSettings() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, togglePodiumVisibility, updatePodiumPointsDisplay } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) return;
    try {
      const res = await api.get(`/api/matches/rules/${leagueId}`);
      if (res?.success && res.data) {
        STATE.scoringRules = res.data.scoringRules || null;
        STATE.championshipRules = res.data.championshipRules || null;      if (res.data.championshipResults) {
          STATE.officialExtras = res.data.championshipResults;
        }
      } else {
        STATE.scoringRules = null;
        STATE.championshipRules = null;
      }
    } catch (err) {
      console.error("Erro ao carregar configurações globais:", err);
      STATE.scoringRules = null;
      STATE.championshipRules = null;  }

    // 🔒 Carrega travas de fase (lockedPhases / unlockedPhases) do backend
    try {
      const settingsRes = await api.get(`/api/settings/global?leagueId=${leagueId}`);
      if (settingsRes?.success && settingsRes.data) {
        STATE.betLockMode =
          settingsRes.data.betLockMode === 'match' ? 'match' : 'grade';

        // 🧪 O modo de teste precisa ser hidratado do backend.
        // Sem isso, o frontend continuava tratando partidas finalizadas
        // como bloqueadas mesmo depois de o administrador ativar o modo teste.
        STATE.testMode = settingsRes.data.testMode === true;
        STATE.groupBetAvailabilityMode =
          settingsRes.data.groupBetAvailabilityMode === 'round' ? 'round' : 'all';
        STATE.unlockedGroupRounds =
          new Set((settingsRes.data.unlockedGroupRounds || []).map(Number));
        STATE.lockedGroupRounds =
          new Set((settingsRes.data.lockedGroupRounds || []).map(Number));

        STATE.pointsRunBetAvailabilityMode =
          settingsRes.data.pointsRunBetAvailabilityMode === 'round' ? 'round' : 'all';
        STATE.unlockedPointsRunRounds =
          new Set((settingsRes.data.unlockedPointsRunRounds || []).map(Number));
        STATE.lockedPointsRunRounds =
          new Set((settingsRes.data.lockedPointsRunRounds || []).map(Number));

        STATE.knockoutBetAvailabilityMode =
          settingsRes.data.knockoutBetAvailabilityMode === 'round' ? 'round' : 'all';
        STATE.unlockedKnockoutRounds =
          new Set((settingsRes.data.unlockedKnockoutRounds || []).map(Number));
        STATE.lockedKnockoutRounds =
          new Set((settingsRes.data.lockedKnockoutRounds || []).map(Number));

        STATE.lockedPhases = new Set(settingsRes.data.lockedPhases || []);
        STATE.unlockedPhases = new Set(settingsRes.data.unlockedPhases || []);
      } else {
        STATE.betLockMode = 'grade';
        STATE.groupBetAvailabilityMode = 'all';
        STATE.unlockedGroupRounds = new Set();
        STATE.lockedGroupRounds = new Set();
        STATE.pointsRunBetAvailabilityMode = 'all';
        STATE.unlockedPointsRunRounds = new Set();
        STATE.lockedPointsRunRounds = new Set();
        STATE.knockoutBetAvailabilityMode = 'all';
        STATE.unlockedKnockoutRounds = new Set();
        STATE.lockedKnockoutRounds = new Set();
        STATE.testMode = false;
        STATE.lockedPhases = new Set();
        STATE.unlockedPhases = new Set();
      }
    } catch (err) {
      console.warn("⚠️ Não foi possível carregar lockedPhases:", err);
      STATE.betLockMode = 'grade';
      STATE.testMode = false;
      STATE.lockedPhases = new Set();
      STATE.unlockedPhases = new Set();
    }

   updatePodiumPointsDisplay();
  togglePodiumVisibility();
  }

  async function loadMatches() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, syncScoresWithGoals } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) {
      console.warn("⚠️ Nenhum leagueId encontrado no localStorage.");
      return [];
    }

    const res = await api.get(`/api/matches?leagueId=${leagueId}`);
    if (!res?.success) throw new Error('Erro ao carregar partidas');

    const sortedData = res.data.slice().sort((a, b) => a.matchId - b.matchId).map(syncScoresWithGoals);
    STATE.matches = sortedData;
    
    return sortedData;
  }

  async function loadMyBets() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasWinnerBet, hasQualifierBet } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) return null;

    const res = await api.get(`/api/bets/my-bets?leagueId=${leagueId}`);
    if (!res?.success) throw new Error('Erro ao carregar palpites');

    STATE.betsMap.clear();
    STATE.knockoutQualifiers.clear();
    STATE.lockedMatches.clear();
    STATE.editingMatches.clear();
    STATE.savedKnockoutGroups.clear();
    STATE.scoresMap.clear(); // 🆕

    STATE.hasSubmitted = !!res.hasSubmitted;

    if (res.data?.groupMatches) {
      res.data.groupMatches.forEach(b => {
        const mIdNum = Number(b.matchId);
        const mIdStr = String(b.matchId);
        const palpite = b.winner; 

        STATE.betsMap.set(mIdNum, palpite);
        STATE.betsMap.set(mIdStr, palpite);
        STATE.lockedMatches.add(mIdNum);

        // 🆕 Carregar scores
        if (b.scoreA != null || b.scoreB != null) {
          STATE.scoresMap.set(mIdNum, { scoreA: b.scoreA, scoreB: b.scoreB });
          STATE.scoresMap.set(mIdStr, { scoreA: b.scoreA, scoreB: b.scoreB });
        }

        if (b.qualifier === 'A' || b.qualifier === 'B') {
          STATE.knockoutQualifiers.set(mIdNum, b.qualifier);
        }
      });
    }

    // 🆕 Converte pódio do formato array (backend) para objeto (frontend interno)
    const podArr = Array.isArray(res.data?.podium) ? res.data.podium : [];
    STATE.podium = {
      first:  podArr[0] || '',
      second: podArr[1] || '',
      third:  podArr[2] || '',
      fourth: podArr[3] || ''
    };

    // 🏆 Carregar previsões de classificação dos grupos.
    STATE.groupPredictions.clear();
    if (Array.isArray(res.data?.groupPredictions)) {
      res.data.groupPredictions.forEach(prediction => {
        const group = String(prediction.group || '').trim();
        if (!group) return;
        STATE.groupPredictions.set(group, {
          group,
          positions: Array.isArray(prediction.positions) ? prediction.positions.map(p => ({
            position: Number(p.position), team: String(p.team || '').trim()
          })).filter(p => Number.isInteger(p.position) && p.team) : [],
          additionalQualifiedTeams: Array.isArray(prediction.additionalQualifiedTeams)
            ? [...new Set(prediction.additionalQualifiedTeams.map(t => String(t).trim()).filter(Boolean))] : []
        });
      });
    }

    // 🆕 Carregar extras (backend retorna dentro de data.extras)
    const ext = res.data?.extras || {};
    if (ext.topScorer != null)    STATE.extras.topScorer    = ext.topScorer;
    if (ext.bestAttack != null)   STATE.extras.bestAttack   = ext.bestAttack;
    if (ext.worstDefense != null) STATE.extras.worstDefense = ext.worstDefense;
    if (ext.upset != null)        STATE.extras.upset        = ext.upset;

    const knockoutGroups = new Set(
      STATE.matches
        .filter(m => typeof isKnockoutMatch === 'function' ? isKnockoutMatch(m) : m.isKnockout)
        .map(m => m.group || 'Mata-mata')
    );

    knockoutGroups.forEach(groupName => {
      const gamesInGroup = STATE.matches.filter(m => {
        const isKO = typeof isKnockoutMatch === 'function' ? isKnockoutMatch(m) : m.isKnockout;
        return isKO && (m.group || 'Mata-mata') === groupName;
      });

      const decisionsEnabled = hasWinnerBet() || gamesInGroup.some(game => hasQualifierBet(game));

      const allDecisionsFilled = decisionsEnabled && gamesInGroup.every(m => {
        const winnerFilled =
          !hasWinnerBet() ||
          STATE.betsMap.has(Number(m.matchId));

        const qualifierFilled =
          !hasQualifierBet(m) ||
          STATE.knockoutQualifiers.has(Number(m.matchId));

        return winnerFilled && qualifierFilled;
      });

      if (allDecisionsFilled && gamesInGroup.length > 0) {
        STATE.savedKnockoutGroups.add(groupName);
      }
    });

    return res;
  }

  async function loadOfficialPodium() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) return null;

    try {
      const res = await api.get(`/api/points/podium?leagueId=${leagueId}`);
      const data = res?.success ? res.data : null;
      STATE.officialPodium = data;
      return data; 
    } catch (err) {
      console.error("⚠️ Erro ao carregar pódio oficial desta liga:", err);
      return null;
    }
  }

  return {
    loadScoringRules,
    loadGlobalSettings,
    loadMatches,
    loadMyBets,
    loadOfficialPodium,
  };
}
