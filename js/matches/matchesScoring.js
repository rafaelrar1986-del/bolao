/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesScoring(ctx = {}) {
  const get = (name) => ctx[name];

  function getScoringRules() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    return STATE.scoringRules || {
      exactScore: 5, scoreTeamA: 1, scoreTeamB: 1,
      winner: 2, qualifier: 3,
      topScorer: 10, bestAttack: 10, worstDefense: 10, upset: 15,
      podiumPoints: [20, 15, 10, 5]
    };
  }

  function getCustomMatchRules() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    const r = getScoringRules();
    return Array.isArray(r.matchRules) ? r.matchRules : [];
  }

  function hasCustomMatchRules() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getCustomMatchRules } = ctx;
    return getCustomMatchRules().length > 0;
  }

  function customRulesHaveCondition(condition) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getCustomMatchRules } = ctx;
    return getCustomMatchRules().some(rule =>
      Array.isArray(rule?.conditions) && rule.conditions.includes(condition)
    );
  }

  function customRulesNeedScoreInput() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getCustomMatchRules } = ctx;
    const scoreConditions = new Set([
      'exactScore',
      'scoreTeamA',
      'scoreTeamB',
      'scoreWinner',
      'scoreLoser',
      'totalGoals',
      'goalDifference'
    ]);

    return getCustomMatchRules().some(rule =>
      Number(rule?.points) > 0 &&
      Array.isArray(rule?.conditions) &&
      rule.conditions.some(condition => scoreConditions.has(condition))
    );
  }

  function hasScoreInput() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, hasCustomMatchRules, customRulesNeedScoreInput } = ctx;
    // O novo construtor de regras é a fonte de verdade sempre que
    // matchRules existir (inclusive quando estiver vazio).
    // Os campos legados exactScore/scoreTeamA/scoreTeamB não podem fazer
    // o campo de placar reaparecer quando o ADM não configurou nenhuma
    // categoria que pontua pelo placar.
    if (Array.isArray(getScoringRules().matchRules)) {
      return customRulesNeedScoreInput();
    }

    const r = getScoringRules();
    return (r.exactScore > 0 || r.scoreTeamA > 0 || r.scoreTeamB > 0);
  }

  function winnerDerivesFromScore() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasScoreInput } = ctx;
    /*
     * winnerFromScore é uma configuração do campeonato, não uma condição
     * de pontuação. Portanto ela continua valendo também quando existem
     * regras customizadas.
     *
     * Se o ADM deixou winnerFromScore = true, ao informar os dois gols o
     * resultado previsto do card é automaticamente derivado do placar.
     * Isso é independente de a regra de pontuação ser:
     *   - Resultado
     *   - Resultado E Classificado
     *   - Placar exato
     *   - Gols do vencedor
     *   - etc.
     *
     * O cálculo oficial continua usando as condições configuradas para
     * decidir quantos pontos serão dados.
     */
    return hasScoreInput() &&
      (STATE.championshipRules?.winnerFromScore !== false);
  }

  function deriveWinnerFromScoreData(scoreData) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    // Placar parcial não define vencedor. A e B precisam estar preenchidos.
    const rawA = scoreData?.scoreA;
    const rawB = scoreData?.scoreB;

    if (
      rawA == null || rawB == null ||
      rawA === '' || rawB === ''
    ) {
      return null;
    }

    const a = Number(rawA);
    const b = Number(rawB);

    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a > b ? 'A' : b > a ? 'B' : 'draw';
  }

  function getDisplayWinner(choice, scoreData) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, winnerDerivesFromScore, deriveWinnerFromScoreData } = ctx;
    if (!winnerDerivesFromScore()) return choice;
    const scoreA = scoreData?.scoreA;
    const scoreB = scoreData?.scoreB;
    if (scoreA == null || scoreB == null || scoreA === '' || scoreB === '') {
      return null;
    }
    return deriveWinnerFromScoreData(scoreData);
  }

  function getPredictionScoreVisualState(match, scoreData = {}) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getMatchRefScore, getLiveRefScore } = ctx;
    if (!match) return 'neutral';

    const hasPredictedScore =
      scoreData.scoreA != null &&
      scoreData.scoreB != null;

    if (!hasPredictedScore) return 'neutral';

    const liveStatuses = [
      '1_tempo',
      'intervalo',
      '2_tempo',
      '1_tet',
      '2_tet',
      'prorrogacao',
      'penaltis',
      'in_progress',
      'live'
    ];

    const isLive = liveStatuses.includes(match.status);

    const isFinished =
      match.status === 'finished' ||
      match.status === 'FT';

    if (!isLive && !isFinished) {
      return 'neutral';
    }

    const ref = isLive
      ? getLiveRefScore(match)
      : getMatchRefScore(match);

    if (ref.scoreA == null || ref.scoreB == null) {
      return 'neutral';
    }

    return (
      Number(scoreData.scoreA) === Number(ref.scoreA) &&
      Number(scoreData.scoreB) === Number(ref.scoreB)
    )
      ? 'correct'
      : 'wrong';
  }

  function getPredictionScoreSideVisualState(
    match,
    scoreData = {},
    side
  ) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getMatchRefScore, getLiveRefScore } = ctx;
    if (!match) return 'neutral';

    const predicted =
      side === 'A'
        ? scoreData.scoreA
        : scoreData.scoreB;

    if (predicted == null) {
      return 'neutral';
    }

    const liveStatuses = [
      '1_tempo',
      'intervalo',
      '2_tempo',
      '1_tet',
      '2_tet',
      'prorrogacao',
      'penaltis',
      'in_progress',
      'live'
    ];

    const isLive = liveStatuses.includes(match.status);

    const isFinished =
      match.status === 'finished' ||
      match.status === 'FT';

    if (!isLive && !isFinished) {
      return 'neutral';
    }

    const ref = isLive
      ? getLiveRefScore(match)
      : getMatchRefScore(match);

    const official =
      side === 'A'
        ? ref.scoreA
        : ref.scoreB;

    if (official == null) {
      return 'neutral';
    }

    return Number(predicted) === Number(official)
      ? 'correct'
      : 'wrong';
  }

  function getPredictionScoreSideInputStyle(
    match,
    scoreData = {},
    side,
    locked = false
  ) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getPredictionScoreSideVisualState } = ctx;
    const state =
      getPredictionScoreSideVisualState(
        match,
        scoreData,
        side
      );

    let background = 'rgba(0,0,0,0.2)';

    if (state === 'correct') {
      background = '#28a745';
    } else if (state === 'wrong') {
      background = '#dc3545';
    }

    return `
      background: ${background};
      color: #fff;
      ${locked ? 'opacity: 0.6;' : ''}
    `;
  }

  function getPredictionScoreInputStyle(match, scoreData = {}, locked = false) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getPredictionScoreVisualState } = ctx;
    const visualState =
      getPredictionScoreVisualState(match, scoreData);

    let background = 'rgba(0,0,0,0.2)';

    if (visualState === 'correct') {
      background = '#28a745';
    } else if (visualState === 'wrong') {
      background = '#dc3545';
    }

    return `
      background: ${background};
      color: #fff;
      ${locked ? 'opacity: 0.6;' : ''}
    `;
  }

  function refreshPredictionScoreInputs(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getPredictionScoreSideVisualState } = ctx;
    if (!match) return;

    const matchCard =
      document.getElementById(`match-${match.matchId}`);

    if (!matchCard) return;

    const idNum = Number(match.matchId);

    const scoreData =
      STATE.scoresMap.get(idNum) ||
      STATE.scoresMap.get(String(match.matchId)) ||
      {};

    matchCard.querySelectorAll('.score-input').forEach(inp => {
      const side = inp.dataset.side;

      const state =
        getPredictionScoreSideVisualState(
          match,
          scoreData,
          side
        );

      let background = 'rgba(0,0,0,0.2)';

      if (state === 'correct') {
        background = '#28a745';
      } else if (state === 'wrong') {
        background = '#dc3545';
      }

      inp.style.background = background;
      inp.style.color = '#fff';
    });
  }

  function hasWinnerBet() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, hasCustomMatchRules, customRulesHaveCondition } = ctx;
    if (hasCustomMatchRules()) return customRulesHaveCondition('result');
    return getScoringRules().winner > 0;
  }

  function hasQualifierBet() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    const match = arguments.length ? arguments[0] : null;
    const phase = String(match?.phase || '').toLowerCase();
    if (phase !== 'knockout') return false;
    const rules = getScoringRules?.() || {};
    return Number(rules?.matchExtras?.qualifier || 0) > 0;
  }

  function hasPodium() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    const r = getScoringRules();
    const arr = Array.isArray(r.podiumPoints) ? r.podiumPoints : [];
    return arr.some(p => p > 0);
  }

  function hasTopScorer() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    return getScoringRules().topScorer > 0;
  }

  function hasBestAttack() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    return getScoringRules().bestAttack > 0;
  }

  function hasWorstDefense() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    return getScoringRules().worstDefense > 0;
  }

  function hasUpset() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    return getScoringRules().upset > 0;
  }

  function hasExtras() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasTopScorer, hasBestAttack, hasWorstDefense, hasUpset } = ctx;
    return hasTopScorer() || hasBestAttack() || hasWorstDefense() || hasUpset();
  }

  function getMatchRefScore(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getChampionshipRules } = ctx;
    if (!match || match.status !== 'finished') {
      return { scoreA: null, scoreB: null };
    }
    const rules = getChampionshipRules();
    const drawIncludesExtraTime = rules.drawIncludesExtraTime ?? false;

    if (drawIncludesExtraTime) {
      return { scoreA: match.scoreA, scoreB: match.scoreB };
    }

    // 🔴 CORREÇÃO CRÍTICA: Fallback para scoreA/B caso regularTimeScore seja nulo/ausente
    return {
      scoreA: match.regularTimeScoreA ?? match.scoreA,
      scoreB: match.regularTimeScoreB ?? match.scoreB
    };
  }

  function getMatchRefWinner(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getMatchRefScore } = ctx;
    if (!match || match.status !== 'finished') return null;
    const ref = getMatchRefScore(match);
    const a = ref.scoreA;
    const b = ref.scoreB;
    if (a == null || b == null) return null;
    if (a > b) return 'A';
    if (b > a) return 'B';
    return 'draw';
  }

  function getMatchRefQualifier(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getChampionshipRules, getKnockoutConfrontationInfo, resolveFrontendKnockoutConfrontationQualifier } = ctx;
    if (!match || match.status !== 'finished') return null;

    const rules = getChampionshipRules();
    if (rules?.knockoutFormat === 'home_away' && isKnockoutMatch(match)) {
      const info = getKnockoutConfrontationInfo(match);
      if (info?.legs?.length >= 2) {
        const resolved = resolveFrontendKnockoutConfrontationQualifier(match, info);
        if (resolved) return resolved;
        return null;
      }
    }

    // O backend considera qualifiedSide como fonte oficial em partidas
    // finalizadas. Isso inclui decisões definidas manualmente pelo admin.
    return getBackendAlignedQualifier(match, { championshipRules: rules });
  }

  function getLiveRefScore(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getChampionshipRules } = ctx;
    if (!match) return { scoreA: null, scoreB: null };
    const rules = getChampionshipRules();
    const drawIncludesExtraTime = rules.drawIncludesExtraTime ?? false;

    let realA = match.scoreA;
    let realB = match.scoreB;

    if (!drawIncludesExtraTime) {
      // Prioriza placar do tempo normal; fallback para placar atual
      if (match.regularTimeScoreA != null) realA = match.regularTimeScoreA;
      if (match.regularTimeScoreB != null) realB = match.regularTimeScoreB;
    }

    return { scoreA: realA, scoreB: realB };
  }

  function getLiveRefWinner(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getLiveRefScore } = ctx;
    if (!match) return null;
    const ref = getLiveRefScore(match);
    const a = ref.scoreA;
    const b = ref.scoreB;
    if (a == null || b == null) return null;
    if (a > b) return 'A';
    if (b > a) return 'B';
    return 'draw';
  }

  function getLiveRefQualifier(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getLiveRefScore } = ctx;
    if (!match || !isKnockoutMatch(match)) return null;

    const ref = getLiveRefScore(match);
    const sA = ref.scoreA;
    const sB = ref.scoreB;
    const pA = match.penaltiesA;
    const pB = match.penaltiesB;

    // 1. Prioridade: Pênaltis
    if (pA != null && pB != null && pA !== pB) {
      return pA > pB ? 'A' : 'B';
    }
    // 2. Segunda prioridade: Placar ao vivo
    if (sA != null && sB != null && sA !== sB) {
      return sA > sB ? 'A' : 'B';
    }
    // 3. Ainda empatado → sem classificado definido
    return null;
  }

  function calcLivePoints(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, getMatchPointStatusForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getDisplayWinner } = ctx;
    const mId = String(match.matchId);
    const choice = STATE.betsMap.get(mId) ?? STATE.betsMap.get(Number(match.matchId));
    const scoreData =
      STATE.scoresMap.get(Number(match.matchId)) ||
      STATE.scoresMap.get(mId) ||
      {};

    const toBackendChoice = (value) => {
      if (value == null) return null;
      const s = String(value).trim().toLowerCase();
      if (s === 'a' || s === 'home' || s === '1') return 'A';
      if (s === 'b' || s === 'away' || s === '2') return 'B';
      if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
      return value;
    };

    const settings = {
      scoringRules: STATE.scoringRules || {},
      championshipRules: STATE.championshipRules || {},  };

    const betMatch = {
      scoreA: scoreData.scoreA,
      scoreB: scoreData.scoreB,
      winner: toBackendChoice(getDisplayWinner(choice, scoreData)),
      qualifier:
        STATE.knockoutQualifiers.get(mId) ||
        STATE.knockoutQualifiers.get(Number(match.matchId)) ||
        null
    };

    return getMatchPointStatusForUI(betMatch, match, settings, true);
  }

  return {
    getScoringRules,
    getCustomMatchRules,
    hasCustomMatchRules,
    customRulesHaveCondition,
    customRulesNeedScoreInput,
    hasScoreInput,
    winnerDerivesFromScore,
    deriveWinnerFromScoreData,
    getDisplayWinner,
    getPredictionScoreVisualState,
    getPredictionScoreSideVisualState,
    getPredictionScoreSideInputStyle,
    getPredictionScoreInputStyle,
    refreshPredictionScoreInputs,
    hasWinnerBet,
    hasQualifierBet,
    hasPodium,
    hasTopScorer,
    hasBestAttack,
    hasWorstDefense,
    hasUpset,
    hasExtras,
    getMatchRefScore,
    getMatchRefWinner,
    getMatchRefQualifier,
    getLiveRefScore,
    getLiveRefWinner,
    getLiveRefQualifier,
    calcLivePoints,
  };
}
