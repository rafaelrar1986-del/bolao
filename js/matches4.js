import { api } from './api.js';
import { flagEmoji } from './flags.js';
import { $, toast } from './ui.js';
import { getReferenceQualifier as getBackendAlignedQualifier, getMatchPointStatus, getEffectiveBetWinner, calculateMatchPoints as calculateScoringMatchPoints } from './frontendScoring.js?v=1.18'; 

/* =====================
    Helpers
===================== */
function withFlag(name) {
  const f = flagEmoji(name);
  return f ? `${f} ${name}` : name;
}

function flagOnly(name) {
  return flagEmoji(name) || '';
}

export function renderTeamMedia(teamName, logoUrl) {
  const bandeiraLocal = flagEmoji(teamName);

  if (logoUrl && logoUrl !== "") {
    return `
      <div class="logo-wrapper" style="display: inline-flex; vertical-align: middle; width: 22px; height: 22px; justify-content: center; align-items: center;">
        <img src="${logoUrl}" 
             class="team-logo-api" 
             style="display: block; width: 100%; height: 100%; object-fit: contain;" 
             onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<span class=\\'team-emoji\\'>${bandeiraLocal || '🏳️'}</span>';">
      </div>
    `;
  }

  if (bandeiraLocal) {
    return `<span class="team-emoji" style="display: inline-block; vertical-align: middle;">${bandeiraLocal}</span>`;
  }

  return ''; 
}

function isKnockoutMatch(m) {
  if (!m) return false;
  const phase = m.phase == null ? '' : String(m.phase).trim().toLowerCase();
  const stage = m.stage == null ? '' : String(m.stage).trim().toLowerCase();

  // Fase explícita tem prioridade. 'round 24' é uma rodada de grupo,
  // portanto não pode ativar a pontuação de classificado.
  if (phase === 'knockout' || phase === 'mata-mata' || phase.includes('knockout') || phase.includes('mata')) return true;
  if (phase === 'group' || phase === 'groups' || phase === 'grupo' || phase === 'grupos') return false;

  if (/quarter|quartas|semi|semifinal|final|playoff|knockout/.test(stage)) return true;
  if (/round\s*(of\s*)?(16|8|4|2)\b/.test(stage)) return true;

  return false;
}

function statusLabel(status) {
  const s = String(status).toLowerCase().trim();

  const mapping = {
    'scheduled': 'Agendado',
    'agendado': 'Agendado',
    '1_tempo': '1°T',
    'intervalo': 'Intervalo',
    '2_tempo': '2°T',
    'prorrogacao': 'Prorrog.',
    '1_tet': '1°T ET',     
    '2_tet': '2°T ET',     
    'penaltis': 'Pênaltis',
    'finished': 'Encerrado',
    'postponed': 'Adiado',
    'cancelled': 'Cancelado',
    'inprogress': 'Ao Vivo',
    'in_progress': 'Ao Vivo'
  };

  return mapping[s] || status || '-';
}

function resultWinnerFromScore(a, b) {
  if (a == null || b == null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

function parseMatchDate(match) {
  if (!match || !match.date) return null;
  if (match.date instanceof Date) return new Date(match.date.getTime());

  const dateStr = String(match.date).trim();
  const timeStr = match.time ? String(match.time).trim() : '00:00';
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return null;

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  if (
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59
  ) {
    return null;
  }

  let day;
  let month;
  let year;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [year, month, day] = dateStr.split('-').map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    [day, month, year] = dateStr.split('/').map(Number);
  } else {
    return null;
  }

  const timestamp = Date.UTC(
    year,
    month - 1,
    day,
    hours,
    minutes,
    0,
    0
  );

  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? null : d;
}

// O instante acima é sempre UTC, alinhado ao betLockService.
// A interface, porém, continua mostrando o horário local do navegador.
function formatMatchTimeLocal(match) {
  const d = parseMatchDate(match);
  if (!d || isNaN(d.getTime())) return '--:--';

  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatMatchDateLocal(match) {
  const d = parseMatchDate(match);
  if (!d || isNaN(d.getTime())) return 'Data inválida';

  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/* =====================
    🆕 HELPERS DE SCORING RULES (ALINHADO COM BACKEND)
===================== */
function getScoringRules() {
  return STATE.scoringRules || {
    exactScore: 5, scoreTeamA: 1, scoreTeamB: 1,
    winner: 2, qualifier: 3,
    topScorer: 10, bestAttack: 10, worstDefense: 10, upset: 15,
    podiumPoints: [20, 15, 10, 5]
  };
}

function getCustomMatchRules() {
  const r = getScoringRules();
  return Array.isArray(r.matchRules) ? r.matchRules : [];
}

function hasCustomMatchRules() {
  return getCustomMatchRules().length > 0;
}

function customRulesHaveCondition(condition) {
  return getCustomMatchRules().some(rule =>
    Array.isArray(rule?.conditions) && rule.conditions.includes(condition)
  );
}

function customRulesNeedScoreInput() {
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
    Array.isArray(rule?.conditions) &&
    rule.conditions.some(condition => scoreConditions.has(condition))
  );
}

function hasScoreInput() {
  if (hasCustomMatchRules()) return customRulesNeedScoreInput();

  const r = getScoringRules();
  return (r.exactScore > 0 || r.scoreTeamA > 0 || r.scoreTeamB > 0);
}

function winnerDerivesFromScore() {
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
  if (!winnerDerivesFromScore()) return choice;
  const scoreA = scoreData?.scoreA;
  const scoreB = scoreData?.scoreB;
  if (scoreA == null || scoreB == null || scoreA === '' || scoreB === '') {
    return null;
  }
  return deriveWinnerFromScoreData(scoreData);
}

function getPredictionScoreVisualState(match, scoreData = {}) {
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
  if (hasCustomMatchRules()) return customRulesHaveCondition('result');
  return getScoringRules().winner > 0;
}

function hasQualifierBet() {
  const match = arguments.length ? arguments[0] : null;
  const phase = String(match?.phase || '').toLowerCase();
  if (phase !== 'knockout') return false;
  const rules = getScoringRules?.() || {};
  return Number(rules?.matchExtras?.qualifier || 0) > 0;
}

function hasPodium() {
  const r = getScoringRules();
  const arr = Array.isArray(r.podiumPoints) ? r.podiumPoints : [];
  return arr.some(p => p > 0);
}

function hasTopScorer() {
  return getScoringRules().topScorer > 0;
}

function hasBestAttack() {
  return getScoringRules().bestAttack > 0;
}

function hasWorstDefense() {
  return getScoringRules().worstDefense > 0;
}

function hasUpset() {
  return getScoringRules().upset > 0;
}

function hasExtras() {
  return hasTopScorer() || hasBestAttack() || hasWorstDefense() || hasUpset();
}

/* =====================
    🏆 CHAMPIONSHIP RULES HELPERS
===================== */
function getChampionshipRules() {
  return STATE.championshipRules || {
    drawIncludesExtraTime: false,
    podiumSize: 4
  };
}

function getPodiumSize() {
  const rules = getChampionshipRules();
  const rawSize = rules?.podiumSize;
  const size = rawSize == null ? 4 : Number(rawSize);
  return Number.isFinite(size) && size >= 0 ? Math.floor(size) : 4;
}

function getPodiumPositions() {
  const size = getPodiumSize();
  const allPositions = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  return allPositions.slice(0, size);
}

/* =====================
    🔥 LÓGICA DO SHOTMAP (PÊNALTIS)
===================== */
function generateShotmapDots(sequence) {
  let html = '';
  const totalDots = Math.max(5, sequence.length);

  for (let i = 0; i < totalDots; i++) {
    let backgroundColor = '#d2d7d9'; 
    let shadow = 'none';

    if (i < sequence.length) {
      if (sequence[i] === true) {
        backgroundColor = '#2ecc71'; 
        shadow = '0 0 6px rgba(46, 204, 113, 0.6)';
      } else {
        backgroundColor = '#e74c3c'; 
        shadow = '0 0 6px rgba(231, 76, 60, 0.6)';
      }
    }

    html += `
      <span class="shot-dot" style="
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: ${backgroundColor};
        box-shadow: ${shadow};
        border: 1px solid rgba(0, 0, 0, 0.15);
        transition: all 0.3s ease;
      "></span>
    `;
  }
  return html;
}

/* =====================
    🆕 REFERENCE SCORE / WINNER / QUALIFIER (ALINHADO COM BACKEND)
===================== */

/**
 * Retorna o placar de referência para comparação com o palpite do usuário.
 * Respeita a regra drawIncludesExtraTime:
 * - Se true: usa scoreA/B (placar final incluindo prorrogação)
 * - Se false: usa regularTimeScoreA/B (placar dos 90 min), com fallback para scoreA/B
 */
function getMatchRefScore(match) {
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

/**
 * Retorna o vencedor de referência ('A', 'B', 'draw' ou null) para o bolão.
 * Respeita drawIncludesExtraTime do Settings.
 */
function getMatchRefWinner(match) {
  if (!match || match.status !== 'finished') return null;
  const ref = getMatchRefScore(match);
  const a = ref.scoreA;
  const b = ref.scoreB;
  if (a == null || b == null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

/**
 * Retorna o classificado de referência ('A' ou 'B') para partidas de mata-mata.
 * 🟡 CORREÇÃO: Respeita qualifiedSideManuallySet — se true, usa qualifiedSide do backend diretamente.
 */
function getMatchRefQualifier(match) {
  if (!match || match.status !== 'finished') return null;

  // O backend considera qualifiedSide como fonte oficial em partidas
  // finalizadas. Isso inclui decisões definidas manualmente pelo admin.
  return getBackendAlignedQualifier(match, {
    championshipRules: getChampionshipRules()
  });
}

/* ============================================================
   FUNÇÕES DE PLACAR AO VIVO (PARCIAL)
   Calculam pontos baseados no placar em tempo real,
   respeitando drawIncludesExtraTime — alinhadas com o backend.
   ============================================================ */

/**
 * Retorna o placar de referência ao vivo, respeitando drawIncludesExtraTime.
 * Usado para cálculo de pontos parciais em jogos não-finalizados.
 */
function getLiveRefScore(match) {
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

/**
 * Retorna o vencedor ao vivo ('A', 'B', 'draw' ou null).
 */
function getLiveRefWinner(match) {
  if (!match) return null;
  const ref = getLiveRefScore(match);
  const a = ref.scoreA;
  const b = ref.scoreB;
  if (a == null || b == null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

/**
 * Retorna o classificado ao vivo ('A' ou 'B') para mata-mata.
 * Mesma lógica do backend em modo parcial.
 */
function getLiveRefQualifier(match) {
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

/**
 * Calcula pontos parciais de uma partida ao vivo.
 * Alinhada com calcMatchPoints do backend em modo isPartial=true.
 */
function calcLivePoints(match) {
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

  return getMatchPointStatus(betMatch, match, settings, true);
}

/**
 * Sincroniza dados brutos da API com o estado local.
 * Garante que campos derivados estejam consistentes.
 */
function syncScoresWithGoals(match) {
  if (!match) return match;
  // Garante que regularTimeScoreA/B existam (mesmo que null)
  if (!('regularTimeScoreA' in match)) match.regularTimeScoreA = null;
  if (!('regularTimeScoreB' in match)) match.regularTimeScoreB = null;
  if (!('qualifiedSideManuallySet' in match)) match.qualifiedSideManuallySet = false;
  return match;
}

/* =====================
    STATE
===================== */
const STATE = {
  matches: [],
  betsMap: new Map(),
  lockedMatches: new Set(),
  editingMatches: new Set(),
  savedKnockoutGroups: new Set(),
  // 🔒 Modo de bloqueio definido pelo admin: 'grade' ou 'match'.
  // O backend usa 'grade' como padrão quando a configuração não existe.
  betLockMode: 'grade',
  groupBetAvailabilityMode: 'all',
  unlockedGroupRounds: new Set(),
  lockedGroupRounds: new Set(),
  pointsRunBetAvailabilityMode: 'all',
  unlockedPointsRunRounds: new Set(),
  lockedPointsRunRounds: new Set(),
  knockoutBetAvailabilityMode: 'all',
  unlockedKnockoutRounds: new Set(),
  lockedKnockoutRounds: new Set(),
  testMode: false,
  lockedPhases: new Set(),
  unlockedPhases: new Set(),
  hasSubmitted: false,
  allBets: [],
  officialPodium: null,
  officialExtras: null,
  podium: { first:'', second:'', third:'', fourth:'' },

  // 🆕 Regras de pontuação dinâmicas do admin
  scoringRules: null,
  championshipRules: null,
  scoresMap: new Map(), // matchId -> { scoreA, scoreB }
  knockoutQualifiers: new Map(), // matchId -> 'A' | 'B'
  extras: { topScorer:'', bestAttack:'', worstDefense:'', upset:'' },
  groupPredictions: new Map(),
  groupPredictionPoints: new Map(),
  groupPredictionPointsStarted: new Set(),

  groupFilter: 'group',
  groupStatusFilter: 'all',

  knockoutFilter: 'group',
  knockoutStatusFilter: 'all'
};

window.STATE = STATE;

/* =====================
    EXPORTS (app.js)
===================== */
function isGroupMatchBetFilled(match) {
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

export function getMissingGroupQualificationBets() {
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

export function getMissingGroupBets() {
  return STATE.matches
    .filter(m => isMatchAvailableForBetting(m))
    .filter(m => !isGroupMatchBetFilled(m));
}

// 🔒 Regra única de edição no frontend, alinhada ao backend:
// - match: somente a partida/horário determina o bloqueio;
// - grade: além de estar agendada, a fase precisa estar desbloqueada.
// O bloqueio definitivo continua sendo responsabilidade do backend.
function isMatchStartedByStatus(match) {
  if (!match) return false;
  if (STATE.testMode === true) return false;

  const status = String(match.status || '').toLowerCase().trim();

  // Mantém exatamente a mesma convenção do betLockService.js.
  return Boolean(
    status &&
    !['scheduled', 'cancelled', 'postponed'].includes(status)
  );
}

function isMatchStartedByTime(match, now = new Date()) {
  if (STATE.testMode === true) return false;

  const matchDate = parseMatchDate(match);
  if (!matchDate || isNaN(matchDate.getTime())) return false;

  return matchDate.getTime() <= now.getTime();
}

function isMatchAvailableForBetting(match) {
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

// Disponibilidade do mata-mata para o usuário.
// Usa exatamente a mesma configuração controlada pelo Admin:
// - all  -> todas as etapas disponíveis;
// - round -> somente as etapas/rodadas liberadas.
// A validação temporal continua separada: partida iniciada não é aposta pendente.
function isKnockoutMatchAvailableForBetting(match) {
  if (!match || !isKnockoutMatch(match)) return false;
  if (match.status === 'cancelled') return false;
  if (isMatchStartedByStatus(match) || isMatchStartedByTime(match)) return false;

  if (STATE.knockoutBetAvailabilityMode !== 'round') return true;

  const round = Number(match.roundNumber);
  if (!Number.isInteger(round) || round <= 0) return false;

  return STATE.unlockedKnockoutRounds.has(round) &&
         !STATE.lockedKnockoutRounds.has(round);
}

export function isMatchEditable(match, now = new Date()) {
  if (!match) return false;

  // 🧪 Modo de teste: permite editar qualquer partida, inclusive
  // finalizada ou com horário passado, sem alterar seu status oficial.
  if (STATE.testMode === true) return true;

  // Mantém a mesma regra temporal do backend:
  // status não agendado (exceto cancelado/postergado) OU
  // horário da partida já alcançado => bloqueada.
  const startedByStatus = isMatchStartedByStatus(match);
  const startedByTime = isMatchStartedByTime(match, now);

  if (startedByStatus || startedByTime) {
    return false;
  }

  const lockMode = STATE.betLockMode || 'grade';

  if (match.phase === 'group' && STATE.groupBetAvailabilityMode === 'round') {
    return isMatchAvailableForBetting(match);
  }

  // No modo por partida, o horário/status da própria partida é a regra.
  if (lockMode === 'match') {
    return true;
  }

  // No modo por grade, a fase também precisa estar desbloqueada.
  const gradeDaPartida = match.phaseName || match.group || 'Mata-mata';
  const matchPhase = String(match.phase || '').toLowerCase();
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

export function getMissingExtrasBets() {
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

export function getMissingKnockoutQualifiers() {
  return STATE.matches
    .filter(m => isKnockoutMatchAvailableForBetting(m))
    .filter(m => {
      const id = Number(m.matchId);
      const rawId = String(m.matchId);
      const missingWinner =
        hasWinnerBet() &&
        !STATE.betsMap.has(id) &&
        !STATE.betsMap.has(rawId);

      const missingQualifier =
        hasQualifierBet(m) &&
        !STATE.knockoutQualifiers.has(id) &&
        !STATE.knockoutQualifiers.has(rawId);

      return missingWinner || missingQualifier;
    });
}

export function getKnockoutGroupByMatchId(matchId) {
  const m = STATE.matches.find(
    m => String(m.matchId) === String(matchId)
  );
  return m?.group || null;
}

export function getMissingKnockoutDecisionsCount() {
  return STATE.matches
    .filter(m => isKnockoutMatchAvailableForBetting(m))
    .reduce((sum, m) => {
      const id = Number(m.matchId);
      const rawId = String(m.matchId);
      let missing = 0;

      if (hasWinnerBet() &&
          !STATE.betsMap.has(id) &&
          !STATE.betsMap.has(rawId)) {
        missing++;
      }

      if (hasQualifierBet(m) &&
          !STATE.knockoutQualifiers.has(id) &&
          !STATE.knockoutQualifiers.has(rawId)) {
        missing++;
      }

      return sum + missing;
    }, 0);
}

export function markKnockoutGroupAsSaved(groupName) {
  STATE.savedKnockoutGroups.add(groupName);
}

function updateKnockoutProgressUI() {
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
  return formatMatchDateLocal(match);
}

function getKnockoutGroupProgress(groupKey) {
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
    let needed = 0;
    if (hasWinnerBet()) needed++;
    if (hasQualifierBet(m)) needed++;
    return sum + needed;
  }, 0);

  let filledDecisions = 0;
  validGames.forEach(m => {
    if (hasWinnerBet() && STATE.betsMap.has(m.matchId)) filledDecisions++;
    if (hasQualifierBet(m) && STATE.knockoutQualifiers.has(m.matchId)) filledDecisions++;
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
  clearInterval(window.__groupPredictionPointsPointsTimer);
  window.__groupPredictionPointsPointsTimer = setInterval(() => {
    loadGroupPredictionPointsLive();
  }, 30000);
}

function getDraftStorageKey() {
  const leagueId = localStorage.getItem('selectedLeagueId') || 'default';
  const user = window.currentUser || {};
  const userId = user._id || user.id || user.email || 'anonymous';
  return `bolao:draft:${String(leagueId)}:${String(userId)}`;
}

export function saveLocalDraft() {
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

export function clearLocalDraft() {
  try {
    localStorage.removeItem(getDraftStorageKey());
  } catch (error) {
    console.warn('Não foi possível limpar o rascunho local:', error);
  }
}

function applyLocalDraftPayload(payload) {
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

export function loadLocalDraft() {
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

export function buildSavePayload() {
  const leagueId = localStorage.getItem('selectedLeagueId');
  const groupMatches = {};

  // 🆕 CORREÇÃO CRÍTICA: inclui qualifier dentro de groupMatches,
  // pois o backend espera groupMatches[matchId].qualifier
  STATE.betsMap.forEach((v, k) => {
    const score = STATE.scoresMap.get(k) || STATE.scoresMap.get(Number(k));
    const qualifier = STATE.knockoutQualifiers.get(k) || STATE.knockoutQualifiers.get(Number(k)) || null;
    const payloadWinner = winnerDerivesFromScore()
      ? deriveWinnerFromScoreData(score)
      : v;
    groupMatches[String(k)] = {
      winner: payloadWinner,
      scoreA: score?.scoreA ?? null,
      scoreB: score?.scoreB ?? null,
      qualifier: qualifier
    };
  });

  // 🆕 Também inclui matches de mata-mata que só têm qualifier (sem winner)
  STATE.knockoutQualifiers.forEach((v, k) => {
    const key = String(k);
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

function getGroupPhaseProgress(groupKey, games) {
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
          const matchGroup = (m.group || '').trim().toUpperCase();
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

/* =====================
    CONTADORES
===================== */
function getMissingPodiumBets() {
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

/* =====================
    Carregamento de Dados (Multicampeonato)
===================== */
// 🆕 Carrega as regras de pontuação definidas pelo admin (delega para loadGlobalSettings)
async function loadScoringRules() {
  await loadGlobalSettings();
}

async function loadGlobalSettings() {
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

    const decisionsEnabled = hasWinnerBet() || hasQualifierBet(m);

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

/* =====================
    FASE DE GRUPOS
===================== */
window.setMatchFilter = (f) => {
  STATE.groupFilter = f;
  if (f === 'live') STATE.groupStatusFilter = 'all';
  renderMatches();
  updateGroupProgressUI();

  // Grupo e Ao Vivo devem atualizar a pontuação imediatamente ao entrar
  // ou retornar ao filtro. O modo Data permanece exatamente como está.
  if (f === 'group' || f === 'live') {
    loadGroupPredictionPointsLive().catch(err =>
      console.warn('[GroupPredictionPoints] Falha ao atualizar ao entrar no filtro:', err)
    );
  }
};

window.setKnockoutFilter = (f) => {
  STATE.knockoutFilter = f;
  if (f === 'live') STATE.knockoutStatusFilter = 'all';

  document.querySelectorAll('.knockout-pills .pill').forEach(btn => {
    const text = btn.textContent.toLowerCase();
    let isActive = false;

    if (f === 'group' && text.includes('fase')) isActive = true;
    if (f === 'date' && text.includes('data')) isActive = true;
    if (f === 'live' && text.includes('vivo')) isActive = true;

    btn.classList.toggle('active', isActive);
  });

  renderKnockoutMatches();
};

function renderFilterHeader() {
  if (!STATE.hasSubmitted) return '';

  return `
    <div class="filter-wrapper" style="margin-bottom: 20px;">
      <div class="filter-pills-row" style="display: flex; margin-bottom: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        <div class="filter-pills" style="display: flex; gap: 8px;">
          <button class="pill ${STATE.groupFilter === 'group' ? 'active' : ''}" onclick="setMatchFilter('group')">Grupo</button>
          <button class="pill ${STATE.groupFilter === 'date' ? 'active' : ''}" onclick="setMatchFilter('date')">Data</button>
          <button class="pill ${STATE.groupFilter === 'live' ? 'active' : ''}" onclick="setMatchFilter('live')">📡 Ao Vivo</button>
        </div>
      </div>

      ${STATE.groupFilter === 'date' ? `
        <div class="status-filter-row" style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
          <span style="font-size: 13px; color: #ffffff; font-weight: 600;">Pendentes</span>
          <label class="switch">
            <input type="checkbox" ${STATE.groupStatusFilter === 'pending' ? 'checked' : ''} onchange="window.togglePendingFilter(this.checked)">
            <span class="slider round"></span>
          </label>
        </div>
      ` : ''}
    </div>
  `;
}


/* =====================
   🏆 CLASSIFICAÇÃO PREVISTA DOS GRUPOS
===================== */
function getGroupQualificationConfig() {
  const q = STATE.championshipRules?.groupQualification || {};
  const totalTeams = Number(q.totalTeams || 0);
  const groupCount = Number(q.groupCount || 0);
  const totalQualified = Number(q.totalQualified || 0);
  if (
    totalTeams > 0 &&
    groupCount > 0 &&
    totalQualified > 0 &&
    totalTeams % groupCount === 0 &&
    totalQualified <= totalTeams
  ) {
    const teamsPerGroup = totalTeams / groupCount;
    const base = Math.floor(totalQualified / groupCount);
    const additional = totalQualified % groupCount;

    if (
      base <= teamsPerGroup &&
      (additional === 0 || base < teamsPerGroup)
    ) {
      return {
        baseQualifiedPerGroup: base,
        additionalQualifiedCount: additional,
        additionalQualificationPosition: additional > 0 ? base + 1 : null,
        teamsPerGroup,
        totalQualified,
        configured: true
      };
    }
  }
  return {
    baseQualifiedPerGroup: 0,
    additionalQualifiedCount: 0,
    additionalQualificationPosition: null,
    teamsPerGroup: null,
    totalQualified: 0,
    configured: false
  };
}

function getGroupTeams(groupGames) {
  const out=[], seen=new Set();
  groupGames.forEach(m => [m.teamA,m.teamB].forEach(team => {
    const t=String(team||'').trim();
    if(t&&!seen.has(t)){seen.add(t);out.push(t);}
  }));
  return out;
}

function getPredictedResultForMatch(match) {
  const id=Number(match.matchId);
  const score=STATE.scoresMap.get(id)||STATE.scoresMap.get(String(match.matchId))||{};
  const a=Number(score.scoreA), b=Number(score.scoreB);
  if(Number.isFinite(a)&&Number.isFinite(b)) return {a,b,complete:true};
  const winner=STATE.betsMap.get(id) ?? STATE.betsMap.get(String(match.matchId)) ?? null;
  if(['A','B','draw'].includes(winner)) return {a:null,b:null,winner,complete:true};
  return {a:null,b:null,winner:null,complete:false};
}

function calculatePredictedGroupStandings(groupGames) {
  const rows=new Map();
  getGroupTeams(groupGames).forEach(team=>rows.set(team,{team,pts:0,gp:0,gc:0,sg:0,completed:0}));
  groupGames.forEach(match=>{
    const p=getPredictedResultForMatch(match), a=rows.get(match.teamA), b=rows.get(match.teamB);
    if(!a||!b||!p.complete)return;
    a.completed++;b.completed++;
    if(Number.isFinite(p.a)&&Number.isFinite(p.b)){
      a.gp+=p.a;a.gc+=p.b;b.gp+=p.b;b.gc+=p.a;
      if(p.a>p.b)a.pts+=3; else if(p.b>p.a)b.pts+=3; else {a.pts++;b.pts++;}
    } else if(p.winner==='A') a.pts+=3;
    else if(p.winner==='B') b.pts+=3;
    else if(p.winner==='draw'){a.pts++;b.pts++;}
    a.sg=a.gp-a.gc;b.sg=b.gp-b.gc;
  });
  /*
   * A classificação prevista deve usar EXATAMENTE a mesma ordem
   * aplicada pelo backend em groupController.js:
   *
   * 1) pontos
   * 2) confronto direto (pontos)
   * 3) confronto direto (saldo)
   * 4) confronto direto (gols marcados)
   * 5) saldo geral
   * 6) gols marcados
   * 7) nome
   *
   * Aqui calculamos os dados previstos dos confrontos diretos a partir
   * dos próprios palpites do usuário, sem alterar a regra oficial.
   */
  const rowsArray = [...rows.values()];
  const predictedMatches = groupGames
    .map(match => {
      const p = getPredictedResultForMatch(match);
      if (!p?.complete) return null;

      const a = rows.get(match.teamA);
      const b = rows.get(match.teamB);
      if (!a || !b) return null;

      let scoreA = Number.isFinite(p.a) ? p.a : null;
      let scoreB = Number.isFinite(p.b) ? p.b : null;

      return {
        teamA: match.teamA,
        teamB: match.teamB,
        scoreA,
        scoreB,
        winner: p.winner
      };
    })
    .filter(Boolean);

  const h2h = new Map();

  const ensureH2H = (team) => {
    if (!h2h.has(team)) {
      h2h.set(team, {
        pts: 0,
        sg: 0,
        gp: 0
      });
    }
    return h2h.get(team);
  };

  /*
   * Para dois times empatados em pontos, groupController calcula o
   * confronto direto exclusivamente entre eles.
   */
  const getHeadToHead = (teamA, teamB) => {
    const result = {
      ptsA: 0, ptsB: 0,
      sgA: 0, sgB: 0,
      gpA: 0, gpB: 0
    };

    predictedMatches.forEach(match => {
      const involvesBoth =
        (match.teamA === teamA && match.teamB === teamB) ||
        (match.teamA === teamB && match.teamB === teamA);

      if (!involvesBoth) return;

      if (Number.isFinite(match.scoreA) && Number.isFinite(match.scoreB)) {
        const golsA = match.teamA === teamA ? match.scoreA : match.scoreB;
        const golsB = match.teamA === teamB ? match.scoreA : match.scoreB;

        result.gpA += golsA;
        result.gpB += golsB;
        result.sgA += golsA - golsB;
        result.sgB += golsB - golsA;

        if (golsA > golsB) result.ptsA += 3;
        else if (golsB > golsA) result.ptsB += 3;
        else {
          result.ptsA += 1;
          result.ptsB += 1;
        }
      } else {
        if (match.winner === 'A') {
          if (match.teamA === teamA) result.ptsA += 3;
          else result.ptsB += 3;
        } else if (match.winner === 'B') {
          if (match.teamB === teamA) result.ptsA += 3;
          else result.ptsB += 3;
        } else if (match.winner === 'draw') {
          result.ptsA += 1;
          result.ptsB += 1;
        }
      }
    });

    return result;
  };

  return rowsArray.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;

    const h = getHeadToHead(a.team, b.team);

    if (h.ptsB !== h.ptsA) return h.ptsB - h.ptsA;
    if (h.sgB !== h.sgA) return h.sgB - h.sgA;
    if (h.gpB !== h.gpA) return h.gpB - h.gpA;

    if (b.sg !== a.sg) return b.sg - a.sg;
    if (b.gp !== a.gp) return b.gp - a.gp;

    return a.team.localeCompare(b.team, undefined, {
      sensitivity: 'base'
    });
  });
}

function getSavedGroupPrediction(groupName, standings, groupGames = []) {
  const saved = STATE.groupPredictions.get(groupName);

  /*
   * A classificação deve ser DERIVADA dos palpites das partidas enquanto
   * o usuário não tiver alterado manualmente os selects.
   *
   * Nas versões anteriores, a classificação automática inicial (normalmente
   * em ordem alfabética, porque ainda não havia palpites) era gravada em
   * STATE.groupPredictions. Depois disso ela passava a ser tratada como
   * previsão manual e nunca mais acompanhava os novos palpites.
   */
  let manual = saved?.manual === true;

  // Compatibilidade com previsões antigas: se a previsão salva não possui
  // a marca manual e corresponde exatamente à ordem alfabética do grupo,
  // tratamos como a antiga previsão automática e a descartamos.
  if (saved?.positions?.length && saved.manual !== true) {
    const teams = getGroupTeams(groupGames || []);
    const alphabetical = [...teams].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    const savedTeams = saved.positions
      .slice()
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map(p => String(p.team || '').trim());

    const isLegacyAutomatic =
      !Array.isArray(saved.additionalQualifiedTeams) ||
      saved.additionalQualifiedTeams.length === 0
        ? savedTeams.length === alphabetical.length &&
          savedTeams.every((team, i) => team === alphabetical[i])
        : false;

    if (!isLegacyAutomatic) manual = true;
  }

  if (manual && saved?.positions?.length) {
    const map = new Map(saved.positions.map(p => [Number(p.position), p.team]));
    return {
      group: groupName,
      positions: standings.map((row, i) => ({
        position: i + 1,
        team: map.get(i + 1) || row.team
      })),
      additionalQualifiedTeams: [
        ...new Set(saved.additionalQualifiedTeams || [])
      ],
      manual: true
    };
  }

  // Sem previsão manual: sempre mostra a classificação calculada agora.
  return {
    group: groupName,
    positions: standings.map((row, i) => ({
      position: i + 1,
      team: row.team
    })),
    additionalQualifiedTeams: []
  };
}

function getAllAdditionalQualifiedTeams() {
  const all = new Set();
  STATE.groupPredictions.forEach(prediction => {
    (prediction?.additionalQualifiedTeams || []).forEach(team => {
      const value = String(team || '').trim();
      if (value) all.add(value);
    });
  });
  return all;
}

function getGlobalAdditionalQualifiedCount() {
  return getAllAdditionalQualifiedTeams().size;
}

function refreshAllGroupThirdCounters() {
  const config = getGroupQualificationConfig();
  const limit = Number(config.additionalQualifiedCount || 0);
  if (limit <= 0) return;
  const count = getGlobalAdditionalQualifiedCount();
  document.querySelectorAll('.group-prediction-section').forEach(section => {
    const counter = section.querySelector('.group-third-counter');
    if (!counter) return;
    counter.textContent = `${count} de ${limit}`;
    counter.style.color = count === limit ? '#6ee7b7' : '#ffd34d';
  });
}


async function loadGroupPredictionPointsLive() {
  const leagueId = localStorage.getItem('selectedLeagueId') || 'default';
  const predictions = [...STATE.groupPredictions.values()].filter(Boolean);
  if (!predictions.length) return;

  try {
    const response = await api.post(
      `/api/groups/prediction-points?leagueId=${encodeURIComponent(leagueId)}&live=true`,
      { groupPredictions: predictions }
    );
    const data = response?.data || response || {};

    STATE.groupPredictionPoints.clear();
    for (const item of (data.breakdown || [])) {
      const group = String(item.group || '').trim();
      const team = String(item.team || '').trim();
      if (!group || !team) continue;
      if (!STATE.groupPredictionPoints.has(group)) {
        STATE.groupPredictionPoints.set(group, new Map());
      }
      STATE.groupPredictionPoints.get(group).set(team, item);
    }

    STATE.groupPredictionPointsStarted = new Set(
      (data.startedGroups || []).map(String)
    );

    document.querySelectorAll('.group-prediction-section').forEach(section => {
      const group = decodeURIComponent(section.dataset.group || '');
      const points = STATE.groupPredictionPoints.get(group) || new Map();
      const started = STATE.groupPredictionPointsStarted.has(group);

      section.querySelectorAll('.group-prediction-position').forEach(row => {
        const select = row.querySelector('.group-prediction-position-select');
        const el = row.querySelector('.group-prediction-points');
        if (!el) return;

        if (!started) {
          el.textContent = '—';
          el.style.color = '#999';
          return;
        }

        const item = points.get(select?.value || '');
        const pts = Number(item?.points || 0);
        el.textContent = pts > 0 ? `✓ +${pts}` : '✗ 0';
        el.style.color = pts > 0 ? '#6ee7b7' : '#f87171';
      });

      const total = [...points.values()].reduce(
        (sum, item) => sum + Number(item?.points || 0), 0
      );
      const totalEl = section.querySelector('.group-prediction-live-total');
      if (totalEl) {
        totalEl.textContent = started
          ? `🔴 Ao vivo: ${total} pts`
          : '⏳ Aguardando início do grupo';
      }
    });
  } catch (error) {
    console.warn('[GroupPredictionPoints] Falha ao atualizar pontuação LIVE:', error);
  }
}

function renderGroupPredictionSection(groupName, groupGames) {
  const config=getGroupQualificationConfig();
  const rules=STATE.scoringRules?.groupQualificationRules;
  if(!Array.isArray(rules)||rules.length===0) return '';
  if(!groupGames.some(m=>String(m.phase||'').toLowerCase()==='group')) return '';

  const standings=calculatePredictedGroupStandings(groupGames);
  const existingPrediction=STATE.groupPredictions.get(groupName);
  const prediction=getSavedGroupPrediction(groupName,standings,groupGames);

  /*
   * A previsão automática faz parte do palpite e precisa ser persistida
   * mesmo quando o usuário nunca abriu/alterou o select.
   *
   * Se já existe uma previsão manual, preservamos exatamente o que o
   * usuário escolheu.
   */
  // A previsão automática NÃO é gravada em STATE.groupPredictions.
  // Ela é recalculada a cada render a partir dos palpites das partidas.
  // STATE.groupPredictions fica reservado para uma escolha manual do usuário.
  const candidatePosition=config.additionalQualificationPosition;
  const selected=new Set(prediction.additionalQualifiedTeams||[]);
  const globalSelectedCount=getGlobalAdditionalQualifiedCount();
  const teams=getGroupTeams(groupGames);
  const complete=standings.every(r=>r.completed>=groupGames.length/2);
  const limit=Number(config.additionalQualifiedCount||0);

  const rows=prediction.positions.map(p=>{
    const candidate=candidatePosition!=null&&Number(p.position)===Number(candidatePosition);
    const active=selected.has(p.team);
    return `<div class="group-prediction-position" style="display:grid;grid-template-columns:34px minmax(0,1fr) 58px 42px;gap:7px;align-items:center;margin:6px 0;">
      <span style="font-weight:800;text-align:center;">${p.position===1?'🥇':p.position===2?'🥈':p.position===3?'🥉':`${p.position}º`}</span>
      <select class="group-prediction-position-select" data-group="${encodeURIComponent(groupName)}" data-position="${p.position}" data-previous-value="${String(p.team).replace(/"/g,'&quot;')}" style="width:100%;min-width:0;padding:8px 6px;border-radius:7px;">
        ${teams.map(t=>`<option value="${String(t).replace(/"/g,'&quot;')}" ${t===p.team?'selected':''}>${t}</option>`).join('')}
      </select>
      <span class="group-prediction-points" style="font-size:.68rem;font-weight:900;text-align:right;white-space:nowrap;color:#999;">—</span>
      ${candidate?`<button type="button" class="group-third-qualifier ${active?'active':''}" data-group="${encodeURIComponent(groupName)}" data-position="${p.position}" data-team="${String(p.team).replace(/"/g,'&quot;')}" style="width:38px;height:34px;border-radius:8px;border:1px solid ${active?'#ffd34d':'rgba(255,255,255,.18)'};background:${active?'rgba(255,211,77,.18)':'rgba(255,255,255,.06)'};color:${active?'#ffd34d':'#aaa'};font-size:16px;">🏆</button>`:'<span></span>'}
    </div>`;
  }).join('');

  return `<section class="group-prediction-section" data-group="${encodeURIComponent(groupName)}" style="margin-top:12px;padding:12px;border-top:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.025);border-radius:10px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <div><strong style="font-size:.9rem;">🏆 Classificação prevista</strong><div style="font-size:.68rem;color:#999;">Montada automaticamente pelos seus palpites.</div></div>
      ${limit>0?`<span class="group-third-counter" style="font-size:.68rem;color:${globalSelectedCount===limit?'#6ee7b7':'#ffd34d'};">${globalSelectedCount} de ${limit}</span>`:''}
    </div>
    ${rows}
    ${limit>0?`<div style="font-size:.68rem;color:#888;margin-top:6px;">Toque no 🏆 do ${candidatePosition}º colocado para indicar que ele avançará.</div>`:''}
    ${!complete?`<div style="margin-top:7px;font-size:.68rem;color:#f5b942;">A classificação será refinada conforme você preencher mais palpites.</div>`:''}
    <div class="group-prediction-live-total" style="margin-top:8px;text-align:right;font-size:.75rem;font-weight:900;color:#67e8f9;">${STATE.groupPredictionPointsStarted.has(groupName) ? '🔴 Ao vivo: 0 pts' : '⏳ Aguardando início do grupo'}</div>
  </section>`;
}

function persistGroupPredictionFromDom(section) {
  const group=decodeURIComponent(section.dataset.group||'');
  if(!group)return;
  const positions=[...section.querySelectorAll('.group-prediction-position-select')].map(select=>({
    position:Number(select.dataset.position),team:select.value
  })).filter(p=>Number.isInteger(p.position)&&p.team);
  const old=STATE.groupPredictions.get(group)||{};
  const candidate=getGroupQualificationConfig().additionalQualificationPosition;
  const candidateTeam=positions.find(p=>Number(p.position)===Number(candidate))?.team;
  const additional=new Set(old.additionalQualifiedTeams||[]);
  const oldCandidate=old.positions?.find(p=>Number(p.position)===Number(candidate))?.team;
  if(oldCandidate&&oldCandidate!==candidateTeam) additional.delete(oldCandidate);
  STATE.groupPredictions.set(group,{
    group,
    positions,
    additionalQualifiedTeams:[...additional],
    manual:true
  });
}

function rerenderGroupPrediction(group) {
  const section=document.querySelector(`.group-prediction-section[data-group="${encodeURIComponent(group)}"]`);
  if(!section)return;
  const games=STATE.matches.filter(m=>!isKnockoutMatch(m)&&String(m.group||'').trim()===group);
  section.outerHTML=renderGroupPredictionSection(group,games);
  const fresh=document.querySelector(`.group-prediction-section[data-group="${encodeURIComponent(group)}"]`);
  if(fresh)bindGroupPredictionSection(fresh);
}

// Recalcula a classificação prevista imediatamente após qualquer palpite
// de uma partida do grupo. A previsão automática não depende de um novo
// carregamento da página.
function refreshPredictedGroupForMatch(matchId) {
  const id = Number(matchId);
  const match = STATE.matches.find(m => Number(m.matchId) === id);
  if (!match || isKnockoutMatch(match)) return;

  const group = String(match.group || '').trim();
  if (!group) return;

  const rules = STATE.scoringRules?.groupQualificationRules;
  if (!Array.isArray(rules) || rules.length === 0) return;

  rerenderGroupPrediction(group);
}

function bindGroupPredictionSection(section) {
  section.querySelectorAll('.group-prediction-position-select').forEach(select=>{
    select.addEventListener('change',()=>{
      const duplicate=[...section.querySelectorAll('.group-prediction-position-select')].find(o=>o!==select&&o.value===select.value);
      if(duplicate) duplicate.value=select.dataset.previousValue||duplicate.value;
      persistGroupPredictionFromDom(section);
      rerenderGroupPrediction(decodeURIComponent(section.dataset.group||''));
    });
  });
  section.querySelectorAll('.group-third-qualifier').forEach(button=>{
    button.addEventListener('click',()=>{
      persistGroupPredictionFromDom(section);
      const group=decodeURIComponent(section.dataset.group||''), prediction=STATE.groupPredictions.get(group);
      if(!prediction)return;
      const team=button.dataset.team, selected=new Set(prediction.additionalQualifiedTeams||[]);
      const config=getGroupQualificationConfig(), limit=Number(config.additionalQualifiedCount||0);
      if(selected.has(team)) selected.delete(team);
      else {
        if(getGlobalAdditionalQualifiedCount()>=limit){toast(`Você já definiu ${limit} palpites de ${config.additionalQualificationPosition}º lugar classificados no campeonato.`,'warning');return;}
        selected.add(team);
      }
      prediction.additionalQualifiedTeams=[...selected];
       prediction.manual=true;
       STATE.groupPredictions.set(group,prediction);
      rerenderGroupPrediction(group);
      refreshAllGroupThirdCounters();
      toast(`${getGlobalAdditionalQualifiedCount()} de ${limit} palpites de ${config.additionalQualificationPosition}° lugar classificado${getGlobalAdditionalQualifiedCount()===1?'':'s'} definido${getGlobalAdditionalQualifiedCount()===1?'':'s'}.`,'success');
    });
  });
}
function bindAllGroupPredictionSections() {
  document.querySelectorAll('.group-prediction-section').forEach(bindGroupPredictionSection);
}

function renderMatches(openedGroups = []) {
  if (!STATE.hasSubmitted) STATE.groupFilter = 'group';

  const wrap = $('#matches-container');
  if (!wrap) return;

  wrap.innerHTML = '';

  let list = (STATE.matches || []).filter(m => !isKnockoutMatch(m));

  // Disponibilidade por rodada:
  // - grupos usam unlockedGroupRounds
  // - pontos corridos usam unlockedPointsRunRounds
  // O modo "all" não restringe a lista.
  list = list.filter(m => {
    const phase = String(m.phase || '').toLowerCase();
    const isGroup = phase === 'group';
    const isPointsRun = phase === 'pontos_corridos' || phase === 'points_run';

    if (!isGroup && !isPointsRun) return true;

    const mode = isGroup
      ? STATE.groupBetAvailabilityMode
      : STATE.pointsRunBetAvailabilityMode;

    if (mode !== 'round') return true;

    const round = Number(m.roundNumber);
    if (!Number.isInteger(round) || round <= 0) return false;

    const unlocked = isGroup
      ? STATE.unlockedGroupRounds
      : STATE.unlockedPointsRunRounds;
    const locked = isGroup
      ? STATE.lockedGroupRounds
      : STATE.lockedPointsRunRounds;

    return unlocked.has(round) && !locked.has(round);
  });

  const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];

  if (STATE.groupFilter === 'live') {
    list = list.filter(m => liveStatuses.includes(m.status));
  } 
  else if (STATE.hasSubmitted && STATE.groupFilter === 'date' && STATE.groupStatusFilter === 'pending') {
    list = list.filter(m => m.status === 'scheduled');
  }

  if (!list.length) {
    let emptyHtml = renderFilterHeader();
    const msg = STATE.groupFilter === 'live' 
      ? 'Nenhuma partida ao vivo no momento para este torneio.' 
      : 'Nenhuma partida encontrada.';
    emptyHtml += `<div style="text-align:center; padding:40px; color:rgba(255,255,255,0.6); font-style: italic;">${msg}</div>`;
    wrap.innerHTML = emptyHtml;
    return;
  }

  let html = renderFilterHeader();
  const groups = {};
  
  list.forEach(m => {
    let key;
    // Data continua sendo agrupada exclusivamente por data.
    // Ao Vivo é agrupado por grupo para que a classificação prevista
    // possa ser mostrada uma única vez para o grupo inteiro.
    if (STATE.hasSubmitted && STATE.groupFilter === 'date') {
      const d = parseMatchDate(m);
      key = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sem data';
    } else {
      key = m.group || m.phaseName || 'Grupo';
    }
    (groups[key] ||= []).push(m);
  });

  html += Object.keys(groups)
    .sort((a, b) => {
      if (STATE.hasSubmitted && STATE.groupFilter === 'date') {
        const da = parseMatchDate(groups[a][0]);
        const db = parseMatchDate(groups[b][0]);
        return (da?.getTime() || 0) - (db?.getTime() || 0);
      }
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    })
    .map((groupName, index) => {
      const games = groups[groupName].slice().sort((a, b) => {
        const da = parseMatchDate(a);
        const db = parseMatchDate(b);
        return (da?.getTime() || 0) - (db?.getTime() || 0);
      });

      // No Ao Vivo, somente as partidas LIVE são exibidas, mas a
      // classificação prevista é sempre calculada sobre TODOS os jogos
      // do grupo, incluindo os ainda agendados.
      const predictionGames = STATE.groupFilter === 'live'
        ? (STATE.matches || [])
            .filter(m =>
              !isKnockoutMatch(m) &&
              String(m.group || '').trim() === String(groupName).trim()
            )
            .slice()
            .sort((a, b) => {
              const da = parseMatchDate(a);
              const db = parseMatchDate(b);
              return (da?.getTime() || 0) - (db?.getTime() || 0);
            })
        : games;

      const rules = getScoringRules();
      const totalPoints = games.reduce((sum, m) => {
        const mId = String(m.matchId);
        const choice = STATE.betsMap.get(mId) || STATE.betsMap.get(Number(mId));
        const scoreData = STATE.scoresMap.get(Number(mId)) || STATE.scoresMap.get(mId) || {};

        if (m.status === 'finished') {
          const result = calculateScoringMatchPoints(
            {
              scoreA: scoreData.scoreA,
              scoreB: scoreData.scoreB,
              winner: choice
            },
            m,
            { scoringRules: rules },
            false
          );
          return sum + result.points;
        }
        else if (liveStatuses.includes(m.status)) {
          // ===== PONTOS PARCIAIS AO VIVO (alinhado com backend) =====
          const liveResult = calcLivePoints(m);
          return sum + liveResult.points;
        }

        return sum;
      }, 0);

      const wasOpen = openedGroups.includes(groupName);
      const isLiveMode = STATE.groupFilter === 'live';
      const isInitialAutoOpen = openedGroups.length === 0 && index === 0;
      const isActive = (wasOpen || isInitialAutoOpen || isLiveMode) ? 'active' : '';

      const progress = getGroupPhaseProgress(groupName, games);
      const percent = progress.mode !== 'none' && progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;
      const barClass = progress.mode === 'games' ? 'progress-fill games' : 'progress-fill decisions';

      return `
        <div class="accordion-item ${isActive}" data-group="${groupName}">
          <button class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
            <div class="accordion-info">
              <div class="accordion-top">
                <span class="accordion-title">${groupName.toUpperCase()}</span>
                ${totalPoints > 0 ? `<span class="accordion-pts">${totalPoints} pts</span>` : ''}
              </div>
              ${progress.mode !== 'none' ? `
                <div class="phase-progress">
                  <div class="progress-bar"><div class="${barClass}" style="width:${percent}%"></div></div>
                  <span class="progress-text">${progress.filled} / ${progress.total}</span>
                </div>
              ` : ''}
            </div>
            <i class="chevron">▼</i>
          </button>
          <div class="accordion-content">
            <div class="group-matches-grid">
              ${games.map(m => renderGroupCard(m)).join('')}
            </div>
            ${renderGroupPredictionSection(groupName, predictionGames)}
          </div>
        </div>
      `;
    }).join('');

  wrap.innerHTML = html;
  bindAllGroupPredictionSections();

  wrap.querySelectorAll('.bet-option').forEach(btn => {
    btn.onclick = (e) => {
      const rawId = btn.dataset.match;
      const idNum = Number(rawId);
      
      if (!STATE.testMode && (STATE.lockedMatches.has(idNum) || STATE.lockedMatches.has(rawId))) {
        return;
      }
      
      e.stopPropagation();

      if (winnerDerivesFromScore()) return;
      
      STATE.betsMap.set(idNum, btn.dataset.choice);
      STATE.betsMap.set(rawId, btn.dataset.choice);
      
      const card = btn.closest('.match-card');
      card.querySelectorAll('.bet-option').forEach(b => {
        b.classList.toggle('selected', b.dataset.choice === btn.dataset.choice);
      });
      
      if (typeof updateBetsCounters === 'function') updateBetsCounters();
      
      if (typeof updateGroupProgressUI === 'function') {
        setTimeout(updateGroupProgressUI, 10);
      }

      refreshPredictedGroupForMatch(idNum);
    };
  });

  // 🆕 Event listeners para inputs de placar
 wrap.querySelectorAll('.score-input').forEach(inp => {

    inp.onmousedown = (e) => {
        e.stopPropagation();

        const rawId = inp.dataset.match;
        const idNum = Number(rawId);

        if (
            (!STATE.testMode &&
             (STATE.lockedMatches.has(idNum) ||
              STATE.lockedMatches.has(rawId))) ||
            !inp.closest('.match-card')
        ) {
            e.preventDefault();
            return;
        }
    };

    inp.onclick = (e) => {
        e.stopPropagation();
    };

    inp.onfocus = (e) => {
        e.stopPropagation();
    };

    inp.oninput = (e) => {
        e.stopPropagation();

        const rawId = inp.dataset.match;
        const idNum = Number(rawId);
        const side = inp.dataset.side;

        const current =
            STATE.scoresMap.get(idNum) ||
            STATE.scoresMap.get(rawId) ||
            {
                scoreA: null,
                scoreB: null
            };

        const updated = { ...current };

        if (side === 'A') {
            updated.scoreA =
                inp.value === ''
                    ? null
                    : parseInt(inp.value);
        }

        if (side === 'B') {
            updated.scoreB =
                inp.value === ''
                    ? null
                    : parseInt(inp.value);
        }

        STATE.scoresMap.set(idNum, updated);
        STATE.scoresMap.set(rawId, updated);

        if (winnerDerivesFromScore()) {
            const derivedWinner = deriveWinnerFromScoreData(updated);
            if (derivedWinner) {
                STATE.betsMap.set(idNum, derivedWinner);
                STATE.betsMap.set(rawId, derivedWinner);
            } else {
                STATE.betsMap.delete(idNum);
                STATE.betsMap.delete(rawId);
            }
            const card = inp.closest('.match-card');
            if (card) {
                card.querySelectorAll('.bet-option').forEach(b => {
                    b.classList.toggle('selected', b.dataset.choice === derivedWinner);
                });
            }
            updateBetsCounters();
            updateGroupProgressUI();
        }

        refreshPredictedGroupForMatch(idNum);
    };
});

}

window.togglePendingFilter = (isPendingOnly) => {
  STATE.groupStatusFilter = isPendingOnly ? 'pending' : 'all';
  renderMatches();
};

function renderGroupCard(m) {
  const idNum = Number(m.matchId);
  const storedChoice = STATE.betsMap.get(idNum) || STATE.betsMap.get(String(m.matchId));
  
  // Declaração antecipada com fallback seguro
  const scoreData = STATE.scoresMap ? (STATE.scoresMap.get(idNum) || STATE.scoresMap.get(String(m.matchId)) || {}) : {};
  const choice = getDisplayWinner(storedChoice, scoreData);
  const matchResult = m.status === 'finished' ? getMatchRefWinner(m) : null;

  const isEditing = window.STATE?.editingMatches?.has(idNum);
  const isLockedCard = !STATE.testMode && STATE.lockedMatches && (STATE.lockedMatches.has(idNum) || STATE.lockedMatches.has(String(m.matchId)));
  const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'].includes(m.status);
  const isScheduled = m.status === 'scheduled' || m.status === 'agendado';
  const isPenalties = m.status === 'penaltis';

  const canEdit = isMatchEditable(m);

  let actionBarHtml = '';
  if (STATE.hasSubmitted && canEdit) {
    if (isEditing) {
      actionBarHtml = `<div class="card-action-bar" style="display: flex; justify-content: flex-end; padding: 6px 8px 0 8px; margin-top: -31px;"><button class="btn-save-bet" onclick="window.saveSingleBet(${m.matchId}, event)" style="background: #2ecc71; color: white; border: none; padding: 4px 12px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">💾 Salvar</button></div>`;
    } else if (isLockedCard) {
      actionBarHtml = `<div class="card-action-bar" style="display: flex; justify-content: flex-start; padding: 6px 8px 0 8px; margin-top: -31px;"><button class="btn-edit-bet" onclick="window.unlockMatchForEdit(${m.matchId}, event)" style="background: lightblue; color: #3498db; border: 1px solid #3498db; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">✏️ Editar</button></div>`;
    }
  }

  let statusClass = isLive ? 'live-match-card' : ''; 
  let points = 0;
  let partialPoints = 0;

  // ===== PONTOS PARCIAIS AO VIVO =====
  if (isLive) {
    const liveResult = calcLivePoints(m);
    partialPoints = liveResult ? (liveResult.points || 0) : 0;
    
    // Agora scoreData existe no escopo
    if (partialPoints > 0) {
      statusClass += ' live-winning';
    } else if (choice || scoreData.scoreA != null) {
      statusClass += ' live-losing';
    }
  }

  if (m.status === 'finished') {
    const rules = getScoringRules();
    const betForScoring = {
      scoreA: scoreData.scoreA,
      scoreB: scoreData.scoreB,
      winner: choice,
      qualifier: userQualifier
    };

    const result = calculateScoringMatchPoints(
      betForScoring,
      m,
      { scoringRules: rules },
      false
    );
    points = result.points;

    // O card do mata-mata deve usar exatamente o mesmo motor de pontuação
    // usado para calcular os pontos. Isso inclui regras personalizadas e
    // o bônus de classificado. Não usar apenas `points > 0`, pois isso
    // transforma qualquer acerto parcial em verde.
    const pointStatus = getMatchPointStatus(
      betForScoring,
      m,
      { scoringRules: rules },
      false
    );
    statusClass = `hit-${pointStatus.category}`;
  }

  const minutoFormatado = (isLive && m.minute && !isPenalties) ? (String(m.minute).includes("'") ? m.minute : m.minute + "'") : "";
  const minuteHtml = `<span class="live-minute-inline">${minutoFormatado}</span>`;

  let centerContentHtml = '';
  if (isLive) {
    centerContentHtml = `<div class="score-container-header big-score"><div class="score-numbers-inline">${renderTeamMedia(m.teamA, m.logoA)} ${isPenalties ? `<span class="score-val pen-a-val">${m.penaltiesA ?? 0}</span> <span class="pen-bubble score-a-val" style="background: #eee; color: #333; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; justify-content: center; align-items: center; font-size: 0.75rem; font-weight: bold; margin-left: 6px; vertical-align: middle; box-shadow: 0 0 5px rgba(0,0,0,0.2);" title="Placar do Tempo Normal">${m.scoreA ?? 0}</span><span class="sep" style="margin: 0 6px;">×</span><span class="pen-bubble score-b-val" style="background: #eee; color: #333; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; justify-content: center; align-items: center; font-size: 0.75rem; font-weight: bold; margin-right: 6px; vertical-align: middle; box-shadow: 0 0 5px rgba(0,0,0,0.2);" title="Placar do Tempo Normal">${m.scoreB ?? 0}</span><span class="score-val pen-b-val">${m.penaltiesB ?? 0}</span>` : `<span class="score-val score-a-val">${m.scoreA ?? 0}</span><span class="sep" style="margin: 0 6px;">×</span><span class="score-val score-b-val">${m.scoreB ?? 0}</span>`}${renderTeamMedia(m.teamB, m.logoB)}</div>${isPenalties ? `<div class="penalties-label-mini" style="font-size: 0.6rem; color: #7f8c8d; font-weight: bold; text-align: center; margin-top: 4px;">PÊNALTIS</div>` : ''}</div>`;
  } else if (isScheduled) {
    centerContentHtml = `<div class="scheduled-time-header"><span class="time-wrapper"><i class="clock-icon">🕒</i><span class="time-value">${formatMatchTimeLocal(m)}</span></span></div>`;
  }

  let shotmapHtml = '';
  if (isPenalties || (m.shootoutDetail && m.shootoutDetail.length > 0)) {
    let seqA = [], seqB = [];
    if (m.shootoutDetail) {
      if (Array.isArray(m.shootoutDetail)) {
        m.shootoutDetail.forEach(item => {
          const isHome = item.home === true || item.team === 'A' || item.team === 'home' || item.team === 'teamA';
          const isConverted = item.type === 'goal' || item.converted === true || item.success === true || item.status === 'score';
          if (isHome) seqA.push(isConverted); else seqB.push(isConverted);
        });
      } else if (typeof m.shootoutDetail === 'object') {
        seqA = m.shootoutDetail.teamA || m.shootoutDetail.home || [];
        seqB = m.shootoutDetail.teamB || m.shootoutDetail.away || [];
      }
    }
    shotmapHtml = `<div class="penalty-shotmap-container" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0, 0, 0, 0.04); border-radius: 8px; margin-top: -39px; margin-bottom: 8px; border: 1px dashed rgba(46, 204, 113, 0.3);"><div class="shotmap-side shotmap-home" style="display: flex; gap: 5px;">${generateShotmapDots(seqA)}</div><span style="font-size: 10px; font-weight: 800; color: #7f8c8d; letter-spacing: 0.5px; text-transform: uppercase;">Série</span><div class="shotmap-side shotmap-away" style="display: flex; gap: 5px;">${generateShotmapDots(seqB)}</div></div>`;
  }

  // ===== LINHA DE PONTOS =====
  const pointsLine = (partialPoints > 0)
    ? `<div class="points-earned partial">+${partialPoints} pts (parcial)</div>`
    : (m.status === 'finished' && points > 0)
      ? `<div class="points-earned">+${points} pts</div>`
      : '';
  const resultLine = m.status === 'finished' ? `<div class="final-score"> ${renderTeamMedia(m.teamA, m.logoA)} ${m.scoreA} x ${m.scoreB} ${renderTeamMedia(m.teamB, m.logoB)}</div>` : '';

  const renderGolsNoCard = (side) => {
    if (!m.goalsDetail || !Array.isArray(m.goalsDetail)) return '';
    const gols = m.goalsDetail.filter(g => g.side === side && (g.type === 'goal' || g.type === 'own-goal' || !g.type));
    return gols.map(g => `<div class="goal-entry-card" style="font-size: 0.62rem; color: #ffca28; font-weight: bold; text-shadow: 1px 1px 2px #000; text-align: center; pointer-events: none; line-height: 1.1; margin-bottom: 2px;">⚽ ${g.name || g.player} ${g.min}'</div>`).join('');
  };

  const scoreInputsHtml = hasScoreInput() ? `
  <div
    class="score-inputs-row"
    style="
      position: ${isScheduled ? 'relative' : 'absolute'};
      top: ${isScheduled ? 'auto' : '48px'};
      left: ${isScheduled ? 'auto' : '0'};
      width: ${isScheduled ? 'auto' : '100%'};
      z-index: 50;
      pointer-events: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 2px;
      padding: 8px 0;
    "
  >
    <input
      type="number"
      min="0"
      class="score-input"
      data-match="${m.matchId}"
      data-side="A"
      value="${scoreData.scoreA ?? ''}"
      placeholder="0"
      ${!canEdit ? 'readonly' : ''}
      style="
        position: relative;
        z-index: 51;
        pointer-events: auto;
        width: 44px;
        text-align: center;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        font-size: 1rem;
        padding: 4px;
        ${getPredictionScoreSideInputStyle(
  m,
  scoreData,
  'A',
  isLockedCard || !canEdit
)}
      "
    >

    <span style="
      color: rgba(255,255,255,0.6);
      font-weight: bold;
    ">×</span>

    <input
      type="number"
      min="0"
      class="score-input"
      data-match="${m.matchId}"
      data-side="B"
      value="${scoreData.scoreB ?? ''}"
      placeholder="0"
      ${!canEdit ? 'readonly' : ''}
      style="
        position: relative;
        z-index: 51;
        pointer-events: auto;
        width: 44px;
        text-align: center;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        font-size: 1rem;
        padding: 4px;
        ${getPredictionScoreSideInputStyle(
  m,
  scoreData,
  'B',
  isLockedCard || !canEdit
)}
      "
    >
  </div>
` : '';

 const winnerButtonsHtml = `
  <div class="bet-options" style="position: relative; display: flex; gap: 5px;">
    ${['A', 'draw', 'B'].map(c => {
      const isDraw = c === 'draw';
      const teamName = c === 'A' ? m.teamA : m.teamB;
      const logoUrl = c === 'A' ? m.logoA : m.logoB;
      const label = isDraw ? 'Empate' : teamName;
      const sideKey = c === 'A' ? 'home' : (c === 'B' ? 'away' : null);

      const buttonLocked =
        isLockedCard ||
        !canEdit ||
        !hasWinnerBet() ||
        winnerDerivesFromScore();

      const buttonStyle = `
        width: 100%;
        z-index: 1;
        ${buttonLocked ? 'pointer-events: none; opacity: 1;' : ''}
      `;

      return `
        <div
          class="option-wrapper"
          style="position: relative; flex: 1; display: flex; flex-direction: column; align-items: center;"
        >
          <div
            class="gols-indicator-container"
            style="position: absolute; top: -33px; left: -21px; width: 100%; z-index: 10; pointer-events: none; display: flex; flex-direction: column; align-items: center;"
          >
            ${sideKey ? renderGolsNoCard(sideKey) : ''}
          </div>

          <button
            class="bet-option ${choice === c ? 'selected' : ''}"
            data-match="${m.matchId}"
            data-choice="${c}"
            style="${buttonStyle}"
          >
            ${!isDraw ? renderTeamMedia(teamName, logoUrl) : ''}
            <span class="bet-team-vertical">${label}</span>
          </button>
        </div>
      `;
    }).join('')}
  </div>
`;

  return `
    <div class="match-card ${statusClass}" id="match-${m.matchId}" data-match-id="${m.matchId}" data-status="${m.status}" data-phase="group" data-team-a="${m.teamA}" data-team-b="${m.teamB}" style="cursor:pointer">
      ${actionBarHtml} 
      <div class="match-header compact">
        <div class="group-label">${m.group || ''}</div>
        ${centerContentHtml}
        <div class="status-wrapper" style="display: flex; align-items: center; gap: 5px;">
          <span class="badge ${m.status}">${statusLabel(m.status)}</span>
          ${minuteHtml} 
        </div>
      </div>
      ${scoreInputsHtml}
      ${winnerButtonsHtml}
      ${shotmapHtml}
      ${resultLine}
      ${pointsLine}
    </div>`;
}

/* =====================
    MATA-MATA (Agrupado com Pontos)
===================== */
function renderKnockoutMatches(openedGroups = []) {
  const wrap = document.getElementById('knockout-container');
  if (!wrap) return;

  let list = STATE.matches.filter(isKnockoutMatch);
  if (STATE.knockoutBetAvailabilityMode === 'round') {
    list = list.filter(m => {
      const round = Number(m.roundNumber);
      return Number.isInteger(round) && round > 0 &&
        STATE.unlockedKnockoutRounds.has(round) &&
        !STATE.lockedKnockoutRounds.has(round);
    });
  }
  const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];
  
  if (STATE.knockoutFilter === 'live') {
    list = list.filter(m => liveStatuses.includes(m.status));
  } 
  else if (STATE.knockoutFilter === 'date' && STATE.knockoutStatusFilter === 'pending') {
    list = list.filter(m => m.status === 'scheduled' || m.status === 'agendado');
  }

  if (!list.length) {
    let emptyHtml = renderKnockoutFilterHeader();
    const msg = STATE.knockoutFilter === 'live' 
      ? 'Nenhum jogo de mata-mata ao vivo agora.' 
      : 'Nenhum jogo pendente encontrado.';
    wrap.innerHTML = emptyHtml + `<div class="details-empty" style="text-align:center; padding:20px; color:rgba(255,255,255,0.6);">${msg}</div>`;
    return;
  }

  let html = renderKnockoutFilterHeader();

  const groups = {};
  list.forEach(m => {
    let key;
    if (STATE.knockoutFilter === 'date' || STATE.knockoutFilter === 'live') {
      const d = parseMatchDate(m);
      key = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sem data';
    } else {
      key = m.group || 'Mata-mata';
    }
    (groups[key] ||= []).push(m);
  });

  html += Object.keys(groups)
    .sort((a, b) => {
      if (STATE.knockoutFilter === 'date' || STATE.knockoutFilter === 'live') {
        const da = parseMatchDate(groups[a][0]);
        const db = parseMatchDate(groups[b][0]);
        return (da?.getTime() || 0) - (db?.getTime() || 0);
      }
      return a.localeCompare(b);
    })
    .map((groupName, index) => {
      const games = groups[groupName].slice().sort((a, b) => {
        const da = parseMatchDate(a);
        const db = parseMatchDate(b);
        return (da?.getTime() || 0) - (db?.getTime() || 0);
      });

      const rules = getScoringRules();
      const groupPoints = games.reduce((sum, m) => {
        let p = 0;
        const mId = String(m.matchId);
        
        const choice = STATE.betsMap.get(mId) || STATE.betsMap.get(Number(mId));
        const userQ = STATE.knockoutQualifiers.get(mId) || STATE.knockoutQualifiers.get(Number(mId));
        const scoreData = STATE.scoresMap.get(Number(mId)) || STATE.scoresMap.get(mId) || {};
        
        // CÁLCULO DE CLASSIFICADO RESPEITANDO FLAG MANUAL DO ADMIN E SCORE DE REFERÊNCIA
        const currentQual = getMatchRefQualifier(m);
        const refScore = getMatchRefScore(m);
        const res = m.status === 'finished' ? getMatchRefWinner(m) : null;
        
        if (m.status === 'finished') {
            const result = calculateScoringMatchPoints(
              {
                scoreA: scoreData.scoreA,
                scoreB: scoreData.scoreB,
                winner: choice,
                qualifier: userQ
              },
              m,
              { scoringRules: rules },
              false
            );
            p += result.points;
        } 
        else if (liveStatuses.includes(m.status)) {
            // ===== PONTOS PARCIAIS AO VIVO (alinhado com backend) =====
            const liveResult = calcLivePoints(m);
            p += liveResult.points;
        }
        
        return sum + p;
      }, 0);

      const wasOpen = openedGroups.includes(groupName);
      const isLiveMode = STATE.knockoutFilter === 'live';
      const isInitialAutoOpen = openedGroups.length === 0 && index === 0;
      const isActive = (wasOpen || isInitialAutoOpen || isLiveMode) ? 'active' : '';

      const progress = getKnockoutGroupProgress(groupName);
      const percent = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;
      const barClass = progress.mode === 'games' ? 'progress-fill games' : 'progress-fill decisions';

      return `
        <div class="accordion-item ${isActive}" data-group="${groupName}">
          <button class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
            <div class="accordion-info">
              <div class="accordion-top">
                <span class="accordion-title">${groupName}</span>
                <span class="accordion-pts">${groupPoints} pts</span>
              </div>
              <div class="phase-progress">
                <div class="progress-bar"><div class="${barClass}" style="width:${percent}%"></div></div>
                <span class="progress-text">${progress.filled} / ${progress.total}</span>
              </div>
            </div>
            <i class="chevron">▼</i>
          </button>
          <div class="accordion-content">
            <div class="group-matches-grid">
              ${games.map(m => renderKnockoutCard(m)).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');

  wrap.innerHTML = html;
  
  if (typeof attachKnockoutEvents === 'function') {
      attachKnockoutEvents(wrap);
  }
  
  if (typeof window.syncEngravedFlags === 'function') {
      setTimeout(window.syncEngravedFlags, 50);
  }
}

function renderKnockoutFilterHeader() {
  if (!STATE.hasSubmitted) return '';

  return `
    <div class="filter-wrapper" style="margin-bottom: 20px;">
      <div class="filter-pills-row" style="display: flex; margin-bottom: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        <div class="filter-pills knockout-pills" style="display: flex; gap: 8px;">
          <button class="pill ${STATE.knockoutFilter === 'group' ? 'active' : ''}" onclick="setKnockoutFilter('group')">Fase</button>
          <button class="pill ${STATE.knockoutFilter === 'date' ? 'active' : ''}" onclick="setKnockoutFilter('date')">Data</button>
          <button class="pill ${STATE.knockoutFilter === 'live' ? 'active' : ''}" onclick="setKnockoutFilter('live')">📡 Ao Vivo</button>
        </div>
      </div>

      ${STATE.knockoutFilter === 'date' ? `
        <div class="status-filter-row" style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
          <span style="font-size: 13px; color: #ffffff; font-weight: 600;">Pendentes</span>
          <label class="switch">
            <input type="checkbox" ${STATE.knockoutStatusFilter === 'pending' ? 'checked' : ''} onchange="window.toggleKnockoutPendingFilter(this.checked)">
            <span class="slider round"></span>
          </label>
        </div>
      ` : ''}
    </div>
  `;
}

window.toggleKnockoutPendingFilter = (isPendingOnly) => {
  STATE.knockoutStatusFilter = isPendingOnly ? 'pending' : 'all';
  renderKnockoutMatches();
};

function renderKnockoutCard(m) {
  const mId = String(m.matchId);
  const idNum = Number(m.matchId);
  
  // Acesso seguro ao STATE e declaração antecipada das apostas/placares
  const storedChoice = STATE.betsMap ? (STATE.betsMap.get(mId) || STATE.betsMap.get(idNum)) : null;
  const userQualifier = STATE.knockoutQualifiers ? (STATE.knockoutQualifiers.get(mId) || STATE.knockoutQualifiers.get(idNum)) : null;
  const scoreData = STATE.scoresMap ? (STATE.scoresMap.get(idNum) || STATE.scoresMap.get(mId) || {}) : {};
  const choice = getDisplayWinner(storedChoice, scoreData);
  const realQualifier = m.qualifiedSide; 
  
  // 🚀 LÓGICA DE EDIÇÃO E TRAVAMENTO DE FASES (Mata-mata)
  const isEditing = window.STATE?.editingMatches?.has(idNum);
  const isSessionLocked = !STATE.testMode && STATE.lockedMatches &&
    (STATE.lockedMatches.has(idNum) || STATE.lockedMatches.has(mId));
  const isLockedByRule = !isMatchEditable(m);
  const isLockedCard = Boolean(isSessionLocked || isLockedByRule);
  const isScheduled = m.status === 'scheduled' || m.status === 'agendado';
  const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'].includes(m.status);
  const isPenalties = m.status === 'penaltis';

  // 🔒 Respeita o modo de bloqueio definido pelo admin.
  const canEdit = !isLockedByRule;

  let actionBarHtml = '';
  if (STATE.hasSubmitted && canEdit) {
    if (isEditing) {
      actionBarHtml = `
        <div class="card-action-bar" style="display: flex; justify-content: flex-end; padding: 6px 8px 0 8px; margin-top: -31px;">
          <button class="btn-save-bet" onclick="window.saveSingleBet(${m.matchId}, event)" 
                  style="background: #2ecc71; color: white; border: none; padding: 4px 12px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">
            💾 Salvar
          </button>
        </div>
      `;
    } else if (isLockedCard) {
      actionBarHtml = `
        <div class="card-action-bar" style="display: flex; justify-content: flex-start; padding: 6px 8px 0 8px; margin-top: -31px;">
          <button class="btn-edit-bet" onclick="window.unlockMatchForEdit(${m.matchId}, event)" 
                  style="background: lightblue; color: #3498db; border: 1px solid #3498db; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">
            ✏️ Editar
          </button>
        </div>
      `;
    }
  }
  
  const matchResult = m.status === 'finished' ? getMatchRefWinner(m) : null;
  let statusClass = isLive ? 'live-match-card' : '';
  let points = 0;
  let partialPoints = 0;

  // CÁLCULO DE CLASSIFICADO RESPEITANDO FLAG MANUAL DO ADMIN E SCORE DE REFERÊNCIA
  const currentQual = getMatchRefQualifier(m);
  const refScore = getMatchRefScore(m);

  // ===== PONTOS PARCIAIS AO VIVO =====
  if (isLive) {
    const liveResult = calcLivePoints(m);
    partialPoints = liveResult ? (liveResult.points || 0) : 0;

    // scoreData agora está devidamente acessível no escopo
    const hasBet = Boolean(choice || userQualifier || scoreData.scoreA != null);
    if (partialPoints > 0 && hasBet) {
      if (liveResult?.breakdown?.qualifier > 0 && liveResult?.breakdown?.winner > 0) {
        statusClass += ' live-winning-full';
      } else {
        statusClass += ' live-winning-partial';
      }
    } else if (hasBet) {
      statusClass += ' live-losing';
    }
  }

  if (m.status === 'finished') {
    const rules = getScoringRules();
    const result = calculateScoringMatchPoints(
      {
        scoreA: scoreData.scoreA,
        scoreB: scoreData.scoreB,
        winner: choice,
        qualifier: userQualifier
      },
      m,
      { scoringRules: rules },
      false
    );
    points = result.points;

    // A classificação visual deve seguir o mesmo motor de pontuação,
    // inclusive quando o campeonato usa regras personalizadas.
    // Não podemos inferir "acerto total" apenas por breakdown.winner,
    // porque uma regra como "Placar exato = 10" preenche
    // breakdown.matchRulePoints, e não breakdown.winner.
    const pointStatus = getMatchPointStatus(
      {
        scoreA: scoreData.scoreA,
        scoreB: scoreData.scoreB,
        winner: choice,
        qualifier: userQualifier
      },
      m,
      { scoringRules: rules },
      false
    );

    statusClass = `hit-${pointStatus.category}`;
  }

  const minutoFormatado = (isLive && m.minute && !isPenalties) 
    ? (String(m.minute).includes("'") ? m.minute : m.minute + "'") : "";
  const minuteHtml = `<span class="live-minute-inline">${minutoFormatado}</span>`;

  let centerContentHtml = '';
  if (isLive) {
    centerContentHtml = `
      <div class="score-container-header big-score">
          <div class="score-numbers-inline">
              ${renderTeamMedia(m.teamA, m.logoA)} 
              
              ${isPenalties ? `
                <span class="score-a-val" style="display: none;">${m.scoreA ?? 0}</span>
                <span class="score-b-val" style="display: none;">${m.scoreB ?? 0}</span>
                <span class="score-val pen-a-val">${m.penaltiesA ?? 0}</span> 
                <span class="sep" style="margin: 0 6px;">×</span> 
                <span class="score-val pen-b-val">${m.penaltiesB ?? 0}</span> 
              ` : `
                <span class="score-val score-a-val">${m.scoreA ?? 0}</span> 
                <span class="sep" style="margin: 0 6px;">×</span> 
                <span class="score-val score-b-val">${m.scoreB ?? 0}</span> 
              `}
              
              ${renderTeamMedia(m.teamB, m.logoB)}
          </div>
          ${isPenalties ? `<div class="penalties-label-mini" style="font-size: 0.6rem; color: #7f8c8d; font-weight: bold; text-align: center; margin-top: 4px;">PÊNALTIS</div>` : ''}
      </div>`;
  } else if (isScheduled) {
    centerContentHtml = `<div class="scheduled-time-header"><span class="time-wrapper"><i class="clock-icon" style="font-style: normal; margin-right: 4px;">🕒</i><span class="time-value">${formatMatchTimeLocal(m)}</span></span></div>`;
  }

  let shotmapHtml = '';
  if (isPenalties || (m.shootoutDetail && m.shootoutDetail.length > 0)) {
      let seqA = [];
      let seqB = [];
      if (m.shootoutDetail) {
          if (Array.isArray(m.shootoutDetail)) {
              m.shootoutDetail.forEach(item => {
                  const isHome = item.home === true || item.team === 'A' || item.team === 'home' || item.team === 'teamA';
                  const isConverted = item.type === 'goal' || item.converted === true || item.success === true || item.status === 'score';
                  if (isHome) seqA.push(isConverted);
                  else seqB.push(isConverted);
              });
          } else if (typeof m.shootoutDetail === 'object') {
              seqA = m.shootoutDetail.teamA || m.shootoutDetail.home || [];
              seqB = m.shootoutDetail.teamB || m.shootoutDetail.away || [];
          }
      }
      shotmapHtml = `
          <div class="penalty-shotmap-container" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0, 0, 0, 0.04); border-radius: 8px; margin-top: -39px; margin-bottom: 8px; border: 1px dashed rgba(46, 204, 113, 0.3);">
              <div class="shotmap-side shotmap-home" style="display: flex; gap: 5px;">
                  ${generateShotmapDots(seqA)}
              </div>
              <span style="font-size: 10px; font-weight: 800; color: #7f8c8d; letter-spacing: 0.5px; text-transform: uppercase;">Série</span>
              <div class="shotmap-side shotmap-away" style="display: flex; gap: 5px;">
                  ${generateShotmapDots(seqB)}
              </div>
          </div>
      `;
  }

  // ===== LINHA DE PONTOS =====
  const pointsLine = (partialPoints > 0)
    ? `<div class="points-earned partial">+${partialPoints} pts (parcial)</div>`
    : (m.status === 'finished' && points > 0)
      ? `<div class="points-earned">+${points} pts</div>`
      : ''; 
  
  let qualifierIndicator = '';
  if (m.status === 'finished' && userQualifier && realQualifier) {
    const ok = userQualifier === realQualifier;
    qualifierIndicator = `<span class="qualified-result ${ok ? 'qualified-correct' : 'qualified-wrong'}">${ok ? '✔' : '❌'}</span>`;
  }

  const pA = m.penaltiesA !== null && m.penaltiesA !== undefined ? `<span class="pen-score">(${m.penaltiesA})</span>` : '';
  const pB = m.penaltiesB !== null && m.penaltiesB !== undefined ? `<span class="pen-score">(${m.penaltiesB})</span>` : '';

  const footerScore = (isPenalties || m.status === 'finished') 
    ? `<div class="placar-mini"> ${renderTeamMedia(m.teamA, m.logoA)} <span>${m.scoreA ?? 0}${pA} x ${m.scoreB ?? 0}${pB}</span> ${renderTeamMedia(m.teamB, m.logoB)}</div>`
    : '';

  const renderGolsNoCard = (side) => {
    if (!m.goalsDetail || !Array.isArray(m.goalsDetail)) return '';
    const gols = m.goalsDetail.filter(g => g.side === side && (g.type === 'goal' || g.type === 'own-goal' || !g.type));
    return gols.map(g => `
      <div class="goal-entry-card" style="font-size: 0.62rem; color: #ffca28; font-weight: bold; text-shadow: 1px 1px 2px #000; text-align: center; pointer-events: none; line-height: 1.1; margin-bottom: 2px;">
        ⚽ ${g.name || g.player} ${g.min}'
      </div>`).join('');
  };

const winnerLockedButtons =
  isLockedCard ||
  !canEdit ||
  !hasWinnerBet() ||
  winnerDerivesFromScore();

const qualifierLockedButtons =
  isLockedCard ||
  !canEdit ||
  !hasQualifierBet(m);

  return `
    <div class="match-card ${statusClass}" 
          id="match-${m.matchId}"
          data-match-id="${m.matchId}"
          data-status="${m.status}"
          data-phase="knockout"
          data-team-a="${m.teamA}" 
          data-team-b="${m.teamB}" 
          style="cursor:pointer">
      
      ${actionBarHtml}

      <div class="match-header compact">
        <div class="group-label">${m.group || `ID: ${m.matchId}`}</div>
        ${centerContentHtml}
        <div class="status-wrapper" style="display: flex; align-items: center; gap: 5px;">
          <span class="badge ${m.status}">${statusLabel(m.status)}</span>
          ${minuteHtml}
        </div>
      </div>

      ${hasScoreInput() ? `
  <div
    class="score-inputs-row"
    style="
      position: relative;
      z-index: 50;
      pointer-events: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 2px;
      padding: 8px 0;
    "
  >
    <input
      type="number"
      min="0"
      class="score-input"
      data-match="${m.matchId}"
      data-side="A"
      value="${scoreData.scoreA ?? ''}"
      placeholder="0"
      ${!canEdit ? 'readonly' : ''}
      style="
        position: relative;
        z-index: 51;
        pointer-events: auto;
        width: 44px;
        text-align: center;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        font-size: 1rem;
        padding: 4px;
        ${getPredictionScoreInputStyle(
          m,
          scoreData,
          false
        )}
      "
    >

    <span style="
      color: rgba(255,255,255,0.6);
      font-weight: bold;
    ">×</span>

    <input
      type="number"
      min="0"
      class="score-input"
      data-match="${m.matchId}"
      data-side="B"
      value="${scoreData.scoreB ?? ''}"
      placeholder="0"
      ${!canEdit ? 'readonly' : ''}
      style="
        position: relative;
        z-index: 51;
        pointer-events: auto;
        width: 44px;
        text-align: center;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        font-size: 1rem;
        padding: 4px;
        ${getPredictionScoreInputStyle(
          m,
          scoreData,
          false
        )}
      "
    >
  </div>
` : ''}

      <div class="bet-options" style="position: relative; display: flex; gap: 5px;">
        ${['A','draw','B'].map(c => {
          const isDraw = c === 'draw';
          const teamName = c === 'A' ? m.teamA : m.teamB;
          const logoUrl = c === 'A' ? m.logoA : m.logoB;
          const label = isDraw ? 'Empate' : teamName;
          const sideKey = c === 'A' ? 'home' : (c === 'B' ? 'away' : null);

          const buttonStyle = `width: 100%; z-index: 1; ${winnerLockedButtons ? 'pointer-events: none; opacity: 1;' : ''}`;

          return `
            <div class="option-wrapper" style="position: relative; flex: 1; display: flex; flex-direction: column; align-items: center;">
              <div class="gols-indicator-container" style="position: absolute; top: -33px; left: -21px; width: 100%; z-index: 10; pointer-events: none; display: flex; flex-direction: column; align-items: center;">
                ${sideKey ? renderGolsNoCard(sideKey) : ''}
              </div>
              <button class="bet-option ${choice === c ? 'selected' : ''}"
                data-match="${m.matchId}" data-choice="${c}"
                style="${buttonStyle}">
                ${!isDraw ? renderTeamMedia(teamName, logoUrl) : ''}
                <span class="bet-team-vertical">${label}</span>
              </button>
            </div>`;
        }).join('')}
      </div>

      ${shotmapHtml}

      ${hasQualifierBet(m) ? `
      <div class="knockout-footer-compact">
        <div class="qual-mini-row">
          <span class="qual-label">Classificado:</span>
          
          <div style="position: relative; display: inline-block;">
              <select data-q="${m.matchId}" 
                      style="${qualifierLockedButtons ? 'pointer-events: none; opacity: 1; cursor: pointer;' : ''}" 
                      onclick="event.stopPropagation()">
                <option value="">...</option>
                <option value="A" ${userQualifier === 'A' ? 'selected' : ''}>${flagOnly(m.teamA)} ${m.teamA}</option>
                <option value="B" ${userQualifier === 'B' ? 'selected' : ''}>${flagOnly(m.teamB)} ${m.teamB}</option>
              </select>
              <div class="engraved-real-flag" style="position: absolute; left: 8px; top: 0; height: 100%; pointer-events: none; display: flex; align-items: center; justify-content: center;"></div>
          </div>
          ${qualifierIndicator}
        </div>
        ${footerScore}
      </div>
      ` : (footerScore ? `<div class="knockout-footer-compact">${footerScore}</div>` : '')}
      ${pointsLine}
    </div>
  `;
}

function attachKnockoutEvents(wrap) {
  if (!wrap) return;

  // ============================
  // CLASSIFICADO
  // ============================
  wrap.querySelectorAll('select[data-q]').forEach(sel => {
    sel.onclick = e => e.stopPropagation();

    sel.onchange = (e) => {
      e.stopPropagation();

      const rawId = sel.dataset.q;
      const idNum = Number(rawId);

      if (sel.value) {
        STATE.knockoutQualifiers.set(idNum, sel.value);
        STATE.knockoutQualifiers.set(rawId, sel.value);
      } else {
        STATE.knockoutQualifiers.delete(idNum);
        STATE.knockoutQualifiers.delete(rawId);
      }

      updateBetsCounters();
      updateKnockoutProgressUI();

      if (window.syncEngravedFlags) {
        window.syncEngravedFlags();
      }
    };
  });

  // ============================
  // VENCEDOR
  // ============================
  wrap.querySelectorAll('.bet-option').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();

      const rawId = btn.dataset.match;
      const idNum = Number(rawId);

      if (
        !STATE.testMode &&
        (STATE.lockedMatches.has(idNum) ||
         STATE.lockedMatches.has(rawId))
      ) {
        return;
      }

      const choice = btn.dataset.choice;

      if (winnerDerivesFromScore()) return;

      STATE.betsMap.set(idNum, choice);
      STATE.betsMap.set(rawId, choice);

      const card = btn.closest('.match-card');

      if (card) {
        card.querySelectorAll('.bet-option').forEach(b => {
          b.classList.toggle(
            'selected',
            b.dataset.choice === choice
          );
        });
      }

      updateBetsCounters();
      updateKnockoutProgressUI();
    };
  });

  // ============================
  // PLACAR
  // ============================
  wrap.querySelectorAll('.score-input').forEach(inp => {

    inp.onmousedown = (e) => {
      e.stopPropagation();

      const rawId = inp.dataset.match;
      const idNum = Number(rawId);

      if (
        (!STATE.testMode &&
         (STATE.lockedMatches.has(idNum) ||
          STATE.lockedMatches.has(rawId))) ||
        !inp.closest('.match-card')
      ) {
        e.preventDefault();
        return;
      }
    };

    inp.onclick = (e) => {
      e.stopPropagation();
    };

    inp.onfocus = (e) => {
      e.stopPropagation();
    };

    inp.oninput = (e) => {
      e.stopPropagation();

      const rawId = inp.dataset.match;
      const idNum = Number(rawId);
      const side = inp.dataset.side;

      const current =
        STATE.scoresMap.get(idNum) ||
        STATE.scoresMap.get(rawId) ||
        {
          scoreA: null,
          scoreB: null
        };

      const updated = { ...current };

      if (side === 'A') {
        updated.scoreA =
          inp.value === ''
            ? null
            : parseInt(inp.value);
      }

      if (side === 'B') {
        updated.scoreB =
          inp.value === ''
            ? null
            : parseInt(inp.value);
      }

      STATE.scoresMap.set(idNum, updated);
      STATE.scoresMap.set(rawId, updated);

      if (winnerDerivesFromScore()) {
        const derivedWinner = deriveWinnerFromScoreData(updated);
        if (derivedWinner) {
          STATE.betsMap.set(idNum, derivedWinner);
          STATE.betsMap.set(rawId, derivedWinner);
        } else {
          STATE.betsMap.delete(idNum);
          STATE.betsMap.delete(rawId);
        }
        const card = inp.closest('.match-card');
        if (card) {
          card.querySelectorAll('.bet-option').forEach(b => {
            b.classList.toggle('selected', b.dataset.choice === derivedWinner);
          });
        }
        updateBetsCounters();
        updateKnockoutProgressUI();
      }
    };
  });
}

function syncKnockoutSelections() {
  const wrap = document.getElementById('knockout-container');
  if (!wrap) return;

  wrap.querySelectorAll('.bet-option').forEach(btn => {
    const rawId = btn.dataset.match;
    const storedChoice = STATE.betsMap.get(rawId) || STATE.betsMap.get(Number(rawId));
    const scoreData = STATE.scoresMap.get(Number(rawId)) || STATE.scoresMap.get(rawId) || {};
    const choice = getDisplayWinner(storedChoice, scoreData);
    btn.classList.toggle('selected', choice === btn.dataset.choice);
  });

  wrap.querySelectorAll('select[data-q]').forEach(sel => {
    const rawId = sel.dataset.q;
    const userQ = STATE.knockoutQualifiers.get(rawId) || STATE.knockoutQualifiers.get(Number(rawId));
    if (userQ) sel.value = userQ;
  });

  if (typeof window.syncEngravedFlags === 'function') {
      setTimeout(window.syncEngravedFlags, 50);
  }
}

/* =====================
    PÓDIO
===================== */
function togglePodiumVisibility() {
  const podiumSection = document.querySelector('.podium-section');
  if (podiumSection) {
    podiumSection.style.display = hasPodium() ? '' : 'none';
  }
}

function updatePodiumPointsDisplay() {
  const rules = getScoringRules();
  const pts = Array.isArray(rules.podiumPoints) ? rules.podiumPoints : [0, 0, 0, 0];
  const size = getPodiumSize();

  // Mapeamento dinâmico baseado no tamanho do pódio
  const positionMap = [
    { selector: '.position-1 .podium-points', index: 0 },
    { selector: '.position-2 .podium-points', index: 1 },
    { selector: '.position-3 .podium-points', index: 2 },
    { selector: '.podium-consolation .podium-points', index: 3 }
  ];

  positionMap.forEach(({ selector, index }) => {
    const el = document.querySelector(selector);
    if (el) {
      // Só mostra pontos se a posição existir no tamanho configurado
      if (index < size) {
        const val = pts[index] || 0;
        el.textContent = val > 0 ? `(${val} pontos)` : '(0 pts)';
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }
  });
}

function fillPodiumSelects() {
  togglePodiumVisibility();
  if (!hasPodium()) return;

  const allMatches = STATE.matches || [];
  const teams = [...new Set(allMatches.flatMap(m => [m.teamA, m.teamB]))].sort();
  
  const positions = getPodiumPositions();

  positions.forEach(p => {
    const el = document.getElementById(`${p}-place`);
    if (!el) return;

    const parentContainer = el.parentElement; 
    const selectedTeam = STATE.podium ? STATE.podium[p] : null;

    const existingDisplays = parentContainer.querySelectorAll('.big-flag-display');
    existingDisplays.forEach(d => d.remove());

    if (STATE.hasSubmitted) {
      el.style.display = 'none';

      if (selectedTeam && selectedTeam.trim() !== "") {
        const teamNameClean = selectedTeam.trim();
        const matchFound = allMatches.find(m => 
          (m.teamA && m.teamA.trim() === teamNameClean) || 
          (m.teamB && m.teamB.trim() === teamNameClean)
        );
        
        let logoUrl = null;
        if (matchFound) {
          logoUrl = (matchFound.teamA.trim() === teamNameClean) ? matchFound.logoA : matchFound.logoB;
        }

        const mediaHtml = renderTeamMedia(selectedTeam, logoUrl);

        const flagHtml = `
          <div class="big-flag-display" style="display: flex; align-items: center; gap: 15px; margin-top: 10px;">
            <div class="flag-wrapper-podium">
              ${mediaHtml}
            </div>
            <span class="flag-team-name" style="font-weight: 700; font-size: 1.rem;">${selectedTeam}</span>
          </div>
        `;
        el.insertAdjacentHTML('afterend', flagHtml);
      } else {
        el.insertAdjacentHTML('afterend', '<div class="big-flag-display"><span class="flag-team-name">—</span></div>');
      }

      updatePodiumIndicator(p);
      return; 
    }

    el.style.display = 'block';
    el.disabled = false;
    el.innerHTML = '<option value="">Selecione...</option>' + 
      teams.map(t => `<option value="${t}">${withFlag(t)}</option>`).join('');

    el.value = selectedTeam || '';

    el.onchange = () => {
      if(!STATE.podium) STATE.podium = {};
      STATE.podium[p] = el.value;
      updatePodiumIndicator(p);

      if (typeof updateBetsCounters === 'function') {
        updateBetsCounters();
      }
    };

    updatePodiumIndicator(p);
  });
}

function updatePodiumIndicator(p) {
  const indicator = document.getElementById(`${p}-indicator`);
  if (!indicator) return;

  const userBet = STATE.podium[p];
  const idxMap = { first: 0, second: 1, third: 2, fourth: 3 };
  const idx = idxMap[p];
  const officialResult = (STATE.officialPodium && Array.isArray(STATE.officialPodium) && idx !== undefined)
    ? STATE.officialPodium[idx]
    : null;

  if (userBet && officialResult) {
    const ok = userBet === officialResult;
    indicator.textContent = ok ? '✔️' : '❌';
    indicator.style.color = ok ? '#28a745' : '#dc3545';
  } else {
    indicator.textContent = ''; 
  }
}

/* =====================
    EXTRAS
===================== */
function renderExtrasSection() {
  const rules = getScoringRules();

  const allMatches = STATE.matches || [];

  // Mesma lista de times utilizada no Pódio
  const teams = [...new Set(
    allMatches.flatMap(m => [m.teamA, m.teamB])
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const extras = [
    {
      key: 'topScorer',
      id: 'extra-top-scorer',
      wrapId: 'extra-top-scorer-wrap',
      pointsId: 'extra-top-scorer-pts',
      label: 'Artilheiro',
      type: 'text'
    },
    {
      key: 'bestAttack',
      id: 'extra-best-attack',
      wrapId: 'extra-best-attack-wrap',
      pointsId: 'extra-best-attack-pts',
      label: 'Melhor Ataque',
      type: 'team'
    },
    {
      key: 'worstDefense',
      id: 'extra-worst-defense',
      wrapId: 'extra-worst-defense-wrap',
      pointsId: 'extra-worst-defense-pts',
      label: 'Pior Defesa',
      type: 'team'
    },
    {
      key: 'upset',
      id: 'extra-upset',
      wrapId: 'extra-upset-wrap',
      pointsId: 'extra-upset-pts',
      label: 'Zebra',
      type: 'team'
    }
  ];

  const enabledExtras = extras.filter(
    extra => Number(rules[extra.key]) > 0
  );

  // Remove seção anterior para evitar duplicação
  const oldSection = document.getElementById('extras-section');
  if (oldSection) oldSection.remove();

  // Nenhum Extra habilitado
  if (!enabledExtras.length) return;

  const section = document.createElement('section');
  section.id = 'extras-section';
  section.className = 'extras-section';

  section.innerHTML = `
    <div class="extras-header">
      <h2>🎯 EXTRAS</h2>
    </div>

    <div class="extras-list">

      ${enabledExtras.map(extra => {

        const inputHtml = extra.type === 'team'
          ? `
            <select
              id="${extra.id}"
              style="
                width: 100%;
                box-sizing: border-box;
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.2);
                background: rgba(0,0,0,0.2);
                color: #fff;
                font-size: 0.95rem;
              "
            >
              <option value="">Selecione...</option>
              ${teams.map(team => `
                <option value="${team}">
                  ${withFlag(team)}
                </option>
              `).join('')}
            </select>
          `
          : `
            <input
              type="text"
              id="${extra.id}"
              placeholder="Digite o nome do jogador..."
              autocomplete="off"
              style="
                width: 100%;
                box-sizing: border-box;
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.2);
                background: rgba(0,0,0,0.2);
                color: #fff;
                font-size: 0.95rem;
              "
            />
          `;

        return `
          <div
            class="extra-item"
            id="${extra.wrapId}"
            style="
              margin-bottom: 14px;
              padding: 14px;
              border-radius: 10px;
              background: rgba(255,255,255,0.05);
            "
          >

            <div
              class="extra-title"
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                margin-bottom: 8px;
              "
            >
              <span style="font-weight: 700;">
                ${extra.label}
              </span>

              <span
                id="${extra.pointsId}"
                style="font-size: 0.85rem; opacity: 0.8;"
              >
                (${Number(rules[extra.key])} pontos)
              </span>

              <span
                id="extra-${extra.key}-indicator"
                class="extra-indicator"
              ></span>
            </div>

            ${inputHtml}

          </div>
        `;
      }).join('')}

    </div>
  `;

  // EXTRAS fica imediatamente antes do PÓDIO
  const podiumSection = document.querySelector('.podium-section');

  if (podiumSection && podiumSection.parentNode) {
    podiumSection.parentNode.insertBefore(section, podiumSection);
  }
}

function updateExtrasPointsDisplay() {
  const rules = getScoringRules();
  const map = {
    'extra-top-scorer-pts':    rules.topScorer,
    'extra-best-attack-pts':   rules.bestAttack,
    'extra-worst-defense-pts': rules.worstDefense,
    'extra-upset-pts':         rules.upset
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `(${val || 0} pontos)`;
  });
}

function updateExtrasIndicator(key) {
  const indicator = document.getElementById(`extra-${key}-indicator`);
  if (!indicator) return;

  const userBet = STATE.extras?.[key];
  const officialResult = STATE.officialExtras?.[key] || null;

  if (userBet && officialResult) {
    const ok = String(userBet).trim().toLowerCase() === String(officialResult).trim().toLowerCase();
    indicator.textContent = ok ? '✔️' : '❌';
    indicator.style.color = ok ? '#28a745' : '#dc3545';
  } else {
    indicator.textContent = '';
  }
}

function fillExtrasInputs() {
    if (!hasExtras()) return;

  const keys = [
    { key: 'topScorer',    id: 'extra-top-scorer',    label: 'Artilheiro' },
    { key: 'bestAttack',   id: 'extra-best-attack',   label: 'Melhor Ataque' },
    { key: 'worstDefense', id: 'extra-worst-defense', label: 'Pior Defesa' },
    { key: 'upset',        id: 'extra-upset',         label: 'Zebra' }
  ];

  keys.forEach(({ key, id, label }) => {
    const el = document.getElementById(id);
    if (!el) return;

    const val = STATE.extras?.[key] || '';

    if (STATE.hasSubmitted) {
      el.style.display = 'none';

      const existing = el.parentElement.querySelector('.extra-display');
      if (existing) existing.remove();

      if (val && String(val).trim() !== '') {
        const display = document.createElement('div');
        display.className = 'extra-display';
        display.innerHTML = `<span>${val}</span>`;
        el.insertAdjacentElement('afterend', display);
      } else {
        const display = document.createElement('div');
        display.className = 'extra-display';
        display.innerHTML = `<span style="color:rgba(255,255,255,0.4)">—</span>`;
        el.insertAdjacentElement('afterend', display);
      }

      updateExtrasIndicator(key);
      return;
    }

    // Remove display se existir (modo edição)
    const existing = el.parentElement.querySelector('.extra-display');
    if (existing) existing.remove();

    el.style.display = 'block';
    el.disabled = false;
    el.value = val;

    const saveExtraValue = () => {
        if (!STATE.extras) {
            STATE.extras = {
                topScorer: '',
                bestAttack: '',
                worstDefense: '',
                upset: ''
            };
        }

        STATE.extras[key] = el.value;

        // Extras fazem parte das pendências obrigatórias.
        // Atualiza imediatamente após cada alteração.
        if (typeof updateBetsCounters === 'function') {
            updateBetsCounters();
        }

        updateExtrasIndicator(key);
    };

if (el.tagName === 'SELECT') {
  el.onchange = saveExtraValue;
} else {
  el.oninput = saveExtraValue;
}

    updateExtrasIndicator(key);
  });
}

function prepareMatchForRender(match) {
    const currentUserId = window.currentUser?._id || window.currentUser?.id;

    if (match.goalsDetail) {
        match.goalsDetail.forEach(event => {
            if (event.type === 'goal' || !event.type) {
                event.userStatusAtThisMoment = checkUserStatusAtScore(match, event.scoreAtTime); 
                event.diffFull = calculateDiff(match, 'full');
                event.diffPartial = calculateDiff(match, 'partial');
                event.diffWrong = calculateDiff(match, 'wrong');
            }
        });
    }
    return match;
}

function renderTimelineHTML(match, allBets = []) {
    const normalize = (val) => {
        if (!val) return '';
        const s = String(val).trim().toLowerCase();
        if (s === 'a' || s === 'home' || s === '1') return 'home';
        if (s === 'b' || s === 'away' || s === '2') return 'away';
        if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
        return s;
    };

    const isKnockout = isKnockoutMatch(match); 
    const currentUserId = window.currentUser?._id || window.currentUser?.id;
    const currentUserName = window.currentUser?.name || window.currentUser?.userName;

    const realQualNormalized = normalize(match.qualifiedSide);

    const rawEvents = (match.goalsDetail || []).map(ev => {
        let extraValue = parseInt(ev.extra) || 0;
        
        if (ev.type === 'period' && ev.name === 'Lance') {
            const relatedInjury = match.goalsDetail.find(i => 
                (i.type === 'injury' || i.type === 'injuryTime') && parseInt(i.min) === parseInt(ev.min)
            );
            if (relatedInjury) {
                extraValue = parseInt(relatedInjury.extra) || parseInt(relatedInjury.description) || 0;
            }
        }
        
        return { 
            ...ev, 
            computedTime: parseInt(ev.min) + extraValue,
            displayExtra: extraValue 
        };
    });

    const events = [...rawEvents].sort((a, b) => {
        if (b.computedTime !== a.computedTime) return b.computedTime - a.computedTime;

        const getWeight = (ev) => {
            if (ev.type === 'period') return 3; 
            if (ev.type === 'injury' || ev.type === 'injuryTime') return 1; 
            return 2; 
        };
        return getWeight(b) - getWeight(a);
    });

    if (events.length === 0) {
        return '<div style="text-align:center; padding:20px; color:#999;">Aguardando lances...</div>';
    }

    return events.map(event => {
        const isSystemEvent = event.type === 'period' || event.type === 'injury' || event.type === 'injuryTime';
        const isHome = event.side === 'home'; 
        
        let icon = '⚽';
        let detailHtml = `<strong>${event.name || event.player || ''}</strong>`;
        let countersHtml = '';

        if (event.type === 'goal' || event.type === 'own-goal' || (!event.type && (event.name || event.player))) {
            let beforeA = 0, beforeB = 0;
            let afterA = 0, afterB = 0;
            
            rawEvents.forEach(e => {
                if (e.type === 'goal' || e.type === 'own-goal' || !e.type) {
                    if (e.computedTime < event.computedTime) {
                        e.side === 'home' ? beforeA++ : beforeB++;
                    }
                    if (e.computedTime <= event.computedTime) {
                        e.side === 'home' ? afterA++ : afterB++;
                    }
                }
            });

            const resBefore = normalize(resultWinnerFromScore(beforeA, beforeB));
            const resAfter = normalize(resultWinnerFromScore(afterA, afterB));

            const qualBefore = (beforeA > beforeB) ? "home" : (beforeB > beforeA ? "away" : null);
            const qualAfter = (afterA > afterB) ? "home" : (afterB > afterA ? "away" : null);

            let diffFull = 0, diffPartial = 0, diffWrong = 0;
            let myStatus = '';

            allBets.forEach(user => {
                const ub = user.bets?.[0];
                if (!ub) return;

                const uChoice = normalize(ub.choice);
                const uQual = normalize(ub.qualifier);

                const hitResBefore = uChoice === resBefore;
                const hitQualBefore = qualBefore !== null && uQual === qualBefore;
                let statusBefore = 'wrong';
                if (isKnockout) {
                    if (hitResBefore && hitQualBefore) statusBefore = 'full';
                    else if (hitResBefore || hitQualBefore) statusBefore = 'partial';
                } else {
                    if (hitResBefore) statusBefore = 'full';
                }

                const hitResAfter = uChoice === resAfter;
                const hitQualAfter = qualAfter !== null && uQual === qualAfter;
                let statusAfter = 'wrong';
                if (isKnockout) {
                    if (hitResAfter && hitQualAfter) statusAfter = 'full';
                    else if (hitResAfter || hitQualAfter) statusAfter = 'partial';
                } else {
                    if (hitResAfter) statusAfter = 'full';
                }

                if (statusBefore !== 'full' && statusAfter === 'full') diffFull++;
                if (statusBefore === 'full' && statusAfter !== 'full') diffFull--;

                if (statusBefore !== 'partial' && statusAfter === 'partial') diffPartial++;
                if (statusBefore === 'partial' && statusAfter !== 'partial') diffPartial--;

                if (statusBefore !== 'wrong' && statusAfter === 'wrong') diffWrong++;
                if (statusBefore === 'wrong' && statusAfter !== 'wrong') diffWrong--;

                const betOwnerId = String(user.userId || user._id || "").trim();
                const myId = String(currentUserId || "").trim();
                const myName = String(currentUserName || "").trim();

                if ((myId !== "" && betOwnerId === myId) || (user.userName === myName)) {
                    myStatus = statusAfter;
                }
            });

            const fmt = (n) => n >= 0 ? `+${n}` : n;
            countersHtml = `
                <div class="timeline-counters" style="display:inline-flex; gap:8px; margin-left:8px; font-weight:bold; font-size:0.8rem; vertical-align:middle;">
                    <span class="${myStatus === 'full' ? 'blink-me' : ''}" style="color:#27ae60">🎯 ${fmt(diffFull)}</span>
                    ${isKnockout ? `<span class="${myStatus === 'partial' ? 'blink-me' : ''}" style="color:#f39c12">🌓 ${fmt(diffPartial)}</span>` : ''}
                    <span class="${myStatus === 'wrong' ? 'blink-me' : ''}" style="color:#e74c3c">❌ ${fmt(diffWrong)}</span>
                </div>`;
        }

        switch (event.type) {
            case 'substitution':
                icon = '🔄';
                detailHtml = `<div style="line-height:1.2;"><span style="color:#27ae60; font-weight:700;">↑ ${event.playerIn || '---'}</span><br><span style="color:#e74c3c; font-size:0.75rem;">↓ ${event.playerOut || '---'}</span></div>`;
                break;
            case 'card':
                icon = (event.description && event.description.includes('red')) ? '🟥' : '🟨';
                break;
            case 'varDecision':
                icon = '🖥️';
                const varText = event.description === 'cardUpgrade' ? 'Vermelho (VAR)' : 'Gol Anulado (VAR)';
                detailHtml = `<strong>${event.name || ''}</strong><br><small style="color:#e67e22;">${varText}</small>`;
                break;
            case 'injuryTime':
            case 'injury':
                icon = '⏱️';
                detailHtml = `<strong>ACRÉSCIMOS: +${event.extra || event.description || '?'} MIN</strong>`;
                break;
            case 'period':
                if (event.name === 'Lance') {
                    icon = '📢';
                    detailHtml = `<strong>FIM DE PERÍODO</strong>`;
                }
                break;
        }

        if (isSystemEvent) {
            return `
                <div class="timeline-item system-event" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; margin: 10px 0; padding: 8px 0; border-top: 1px dashed #eee; border-bottom: 1px dashed #eee; background: #fafafa; text-align: center;">
                    <div style="font-weight: bold; color: #666; font-size: 0.75rem; margin-bottom: 2px;">${event.computedTime}'</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 1.1rem;">${icon}</span>
                        <span style="font-size: 0.8rem; font-weight: bold; color: #333; text-transform: uppercase;">${detailHtml}</span>
                    </div>
                </div>`;
        }

        return `
            <div class="timeline-item ${isHome ? 'home-event' : 'away-event'}" 
                 style="display: flex; align-items: center; width: 100%; margin-bottom: 12px; gap: 10px; 
                 ${isHome ? 'justify-content: flex-start; text-align: left;' : 'justify-content: flex-end; flex-direction: row-reverse; text-align: right;'}">
                
                <div class="event-min" style="font-weight: bold; width: 45px; color: #666; font-size: 0.85rem; flex-shrink: 0; ${!isHome ? 'text-align: right;' : ''}">
                    ${event.min}${event.extra ? '+' + event.extra : ''}'
                </div>

                <div class="event-icon" style="font-size: 1.1rem; min-width: 25px; text-align: center; flex-shrink: 0;">
                    ${icon}
                </div>

                <div class="event-content" style="display: flex; flex-direction: column; ${!isHome ? 'align-items: flex-end;' : 'align-items: flex-start;'}">
                    <div style="font-size: 0.9rem;">${detailHtml}</div>
                    <div style="margin-top: 2px;">${countersHtml}</div>
                </div>
            </div>`;
    }).join('');
}

window.syncModalData = async function(updatedData = null) {
    const modal = document.getElementById('modal-detalhes');
    if (!modal) return;

    const matchId = modal.getAttribute('data-opened-match-id');
    const current = updatedData || STATE.matches.find(m => String(m.matchId) === String(matchId));
    
    if (!current) {
        console.warn(`[Sync] Partida ${matchId} não encontrada no estado global.`);
        return;
    }

    const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress', 'live'];
    const isLive = liveStatuses.includes(current.status);
    const isFinished = current.status === 'finished' || current.status === 'FT';

    const scoreEl = document.getElementById('modal-placar-score');
    if (scoreEl) {
        const scoreHTML = (isLive || isFinished) 
            ? `${current.scoreA} <span class="score-divider">-</span> ${current.scoreB}` 
            : '<span class="vs-label">VS</span>';
        
        if (scoreEl.innerHTML !== scoreHTML) scoreEl.innerHTML = scoreHTML;
    }

    const labelEl = document.getElementById('modal-status-label');
    if (labelEl) {
        labelEl.textContent = isLive ? 'AO VIVO' : (isFinished ? 'FINALIZADO' : 'AGENDADO');
        labelEl.className = isLive ? 'status-badge status-live animate__animated animate__pulse animate__infinite' : 'status-badge';
    }

    const tempoEl = document.getElementById('modal-placar-tempo');
    if (tempoEl) {
        if (isLive) {
            tempoEl.innerHTML = `<div class="status-badge status-live">⏱️ ${current.minute || 0}'</div>`;
        } else if (isFinished) {
            tempoEl.innerHTML = `<div class="status-badge status-finished">FIM DE JOGO</div>`;
        } else {
            tempoEl.innerHTML = `<div class="status-badge status-scheduled">Aguardando Início</div>`;
        }
    }

    const posCont = document.getElementById('possession-container');
    if (posCont && current.possession) {
        const pA = parseInt(current.possession.home || 50);
        const pB = parseInt(current.possession.away || 50);
        posCont.innerHTML = `
            <div class="possession-labels" style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.8rem; font-weight:bold;">
                <span>${pA}% ${current.teamA_short || 'CASA'}</span>
                <span>${current.teamB_short || 'FORA'} ${pB}%</span>
            </div>
            <div class="possession-bar-bg" style="height:8px; background:#eee; border-radius:4px; display:flex; overflow:hidden;">
                <div class="bar-home" style="width: ${pA}%; background:var(--primary-color, #27ae60); transition: width 0.5s ease;"></div>
                <div class="bar-away" style="width: ${pB}%; background:var(--secondary-color, #e74c3c); transition: width 0.5s ease;"></div>
            </div>`;
    }

    const timelineEl = document.getElementById('modal-timeline-content');
    if (timelineEl) {
        const newTimelineHTML = renderTimelineHTML(current);
        if (timelineEl.innerHTML !== newTimelineHTML) {
            timelineEl.innerHTML = newTimelineHTML;
        }
    }

    if (typeof fetchAndRenderBets === 'function') {
        try {
            await fetchAndRenderBets(current);
        } catch (e) {
            console.error("Erro ao atualizar palpites no modal:", e);
        }
    }
};

async function fetchAndRenderBets(matchObj) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        const matchIdStr = String(matchObj.matchId);

        const matchCard = document.getElementById(`match-${matchIdStr}`);
        const phaseFromCard = matchCard ? String(matchCard.getAttribute('data-phase')).toLowerCase() : "";
        const groupName = String(matchObj.group || matchObj.phaseName || "").toLowerCase();

        const isKnockout = isKnockoutMatch(matchObj) || 
                           phaseFromCard === 'knockout' || 
                           phaseFromCard === 'mata-mata' ||
                           groupName.includes('avos') || 
                           groupName.includes('16') ||
                           groupName.includes('final') ||
                           matchObj.phase === 'knockout';

        const currentUserIdStr = String(window.currentUser?._id || window.currentUser?.id || localStorage.getItem('userId') || "").trim();
        const currentUserNameStr = String(window.currentUser?.name || window.currentUser?.userName || "").trim();
        
        const [res, settingsRes, leaderboardRes] = await Promise.all([
            api.get(`/api/bets/all-bets?matchId=${matchIdStr}&leagueId=${leagueId}`),
            api.get(`/api/settings/global?leagueId=${leagueId}`),
            api.get(`/api/bets/leaderboard?leagueId=${leagueId}&type=partial`)
        ]);

        const allBets = res?.data || [];
        const unlockedPhases = settingsRes?.success ? (settingsRes.data.unlockedPhases || []) : [];
        
        const isFinish = matchObj.status === 'finished';
        const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress', 'live'].includes(matchObj.status);
        const isLiveOrFinished = isFinish || isLive;

        const normalize = (val) => {
            if (!val) return '';
            const s = String(val).trim().toLowerCase();
            if (s === 'a' || s === 'home' || s === '1') return 'home';
            if (s === 'b' || s === 'away' || s === '2') return 'away';
            if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
            return s;
        };

        const refScore = isLive
          ? getLiveRefScore(matchObj)
          : getMatchRefScore(matchObj);
        const scoreA = parseInt(refScore.scoreA) || 0;
        const scoreB = parseInt(refScore.scoreB) || 0;
        const pA = parseInt(matchObj.penaltiesA) || 0;
        const pB = parseInt(matchObj.penaltiesB) || 0;
        const realResult = normalize(isLive ? getLiveRefWinner(matchObj) : getMatchRefWinner(matchObj));

        let realQual = null;
        if (isKnockout) {
            realQual = normalize(isLive ? getLiveRefQualifier(matchObj) : getMatchRefQualifier(matchObj));
        }

        const liveRankingList = leaderboardRes?.success ? (leaderboardRes.data || []) : [];

        allBets.sort((a, b) => {
            const getPos = (userObj) => {
                const bId = String(userObj.userId || userObj._id || userObj.user?._id || userObj.user?.id || "").trim();
                const bName = String(userObj.userName || userObj.name || userObj.user?.userName || userObj.user?.name || "").trim();
                
                const matchInList = liveRankingList.find(item => {
                    const rId = String(item.user?._id || item.user?.id || "").trim();
                    const rName = String(item.user?.name || "").trim();
                    return (bId !== "" && rId === bId) || (bName !== "" && rName === bName);
                });
                return matchInList && matchInList.position != null ? matchInList.position : Infinity;
            };
            return getPos(a) - getPos(b);
        });

        STATE.allBets = allBets; 

        const myLiveMatch = liveRankingList.find(item => {
            const rId = String(item.user?._id || item.user?.id || "").trim();
            const rName = String(item.user?.name || "").trim();
            return (currentUserIdStr !== "" && rId === currentUserIdStr) || 
                   (currentUserNameStr !== "" && rName === currentUserNameStr);
        });
        const myLivePos = myLiveMatch ? myLiveMatch.position : null;

        const generateUserCardHtml = (user, extraClass = '') => {
            const betOwnerId = String(user.userId || user._id || user.user?._id || user.user?.id || "").trim();
            const betOwnerName = String(user.userName || user.name || user.user?.userName || user.user?.name || "Usuário").trim();

            const isMe = (currentUserIdStr !== "" && betOwnerId === currentUserIdStr) || 
                         (currentUserNameStr !== "" && betOwnerName === currentUserNameStr);

            const matchInLiveList = liveRankingList.find(item => {
                const rId = String(item.user?._id || item.user?.id || "").trim();
                const rName = String(item.user?.name || "").trim();
                return (betOwnerId !== "" && rId === betOwnerId) || (betOwnerName !== "" && rName === betOwnerName);
            });
            const cardLivePos = matchInLiveList ? matchInLiveList.position : null;

            let cardClasses = ['bet-user-card'];
            if (isMe) cardClasses.push('blink-me');
            if (extraClass) cardClasses.push(extraClass);

            let inlineStyle = '';
            if (cardLivePos === 1) {
                inlineStyle = 'background: rgba(255, 215, 0, 0.16) !important; border: 1px solid rgba(255, 215, 0, 0.8) !important; box-shadow: 0 0 15px rgba(255, 215, 0, 0.45), inset 0 0 6px rgba(255, 215, 0, 0.1) !important; color: #ffd700 !important;';
            } else if (!isMe && myLivePos !== null && cardLivePos !== null) {
                if (cardLivePos < myLivePos) {
                    inlineStyle = 'background: rgba(46, 204, 113, 0.14) !important; border: 1px solid rgba(46, 204, 113, 0.7) !important; box-shadow: 0 0 12px rgba(46, 204, 113, 0.35) !important; color: #2ecc71 !important;';
                } else if (cardLivePos > myLivePos) {
                    inlineStyle = 'background: rgba(231, 76, 60, 0.08) !important; border: 1px solid rgba(231, 76, 60, 0.45) !important; box-shadow: 0 0 10px rgba(231, 76, 60, 0.15) !important; color: #e74c3c !important;';
                }
            }

            let nameStyle = isMe ? 'text-shadow: 0 0 8px currentColor !important; font-weight: bold !important; color: inherit !important;' : '';
            
            const displayName = cardLivePos ? `${cardLivePos}° ${betOwnerName}` : betOwnerName;

            return `<div class="${cardClasses.join(' ').trim()}" style="${inlineStyle}">
                        <span style="${nameStyle}">${displayName}</span>
                    </div>`;
        };

        let htmlResult = '';

        if (isLiveOrFinished) {
            const full = [], partial = [], wrong = [];

            const modalSettings = {
                scoringRules: settingsRes?.success ? (settingsRes.data?.scoringRules || STATE.scoringRules || {}) : (STATE.scoringRules || {}),
                championshipRules: settingsRes?.success ? (settingsRes.data?.championshipRules || STATE.championshipRules || {}) : (STATE.championshipRules || {}),            };

            const toBackendChoice = (value) => {
                if (value == null) return null;
                const s = String(value).trim().toLowerCase();
                if (s === 'a' || s === 'home' || s === '1') return 'A';
                if (s === 'b' || s === 'away' || s === '2') return 'B';
                if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
                return value;
            };

            allBets.forEach(user => {
                // /all-bets normalmente devolve bets como array. Mantemos
                // fallback para objeto único para não perder participantes
                // caso o backend/versão da API entregue uma única aposta.
                const ub = Array.isArray(user?.bets)
                    ? user.bets[0]
                    : (user?.bets || user?.bet || null);
                if (!ub) return;

                const betMatch = {
                    scoreA: ub.scoreA,
                    scoreB: ub.scoreB,
                    winner: toBackendChoice(ub.choice ?? ub.winner),
                    qualifier: toBackendChoice(ub.qualifier)
                };

                let status;
                try {
                    status = getMatchPointStatus(
                        betMatch,
                        matchObj,
                        modalSettings,
                        isLiveOrFinished
                    );
                } catch (statusError) {
                    // O modal nunca deve desaparecer por uma falha de cálculo
                    // visual. Fallback conservador: se houver algum critério
                    // antigo acertado, fica em parcial; caso contrário, errado.
                    console.warn('[Modal Ranking] Falha ao calcular status:', statusError);
                    const fallbackWinner = toBackendChoice(ub.choice ?? ub.winner);
                    const fallbackQualifier = toBackendChoice(ub.qualifier);
                    const fallbackResult = toBackendChoice(realResult);
                    const fallbackQual = toBackendChoice(realQual);
                    const fallbackHitWinner = fallbackWinner && fallbackResult && fallbackWinner === fallbackResult;
                    const fallbackHitQualifier = isKnockout && fallbackQualifier && fallbackQual && fallbackQualifier === fallbackQual;
                    status = {
                        points: 0,
                        category: (fallbackHitWinner && fallbackHitQualifier) ? 'full' : ((fallbackHitWinner || fallbackHitQualifier) ? 'partial' : 'wrong')
                    };
                }

                const cardHtml = generateUserCardHtml(user);

                if (status.category === 'full') {
                    full.push(cardHtml);
                } else if (status.category === 'partial') {
                    partial.push(cardHtml);
                } else {
                    wrong.push(cardHtml);
                }
            });

            // O modal usa sempre as 3 colunas fixas.
            // Antes, em partidas de grupos, a coluna PARCIAL era escondida;
            // com pontuação por placar isso fazia usuários que pontuavam
            // parcialmente desaparecerem do modal.
            htmlResult = `
                <div class="bet-grid grid-3">
                    <div>
                        <div class="bet-column-title" style="color:#27ae60">🎯 Acertando (${full.length})</div>
                        ${full.join('') || '<div class="bet-user-card">—</div>'}
                    </div>
                    <div>
                        <div class="bet-column-title" style="color:#f39c12">🌓 Parcial (${partial.length})</div>
                        ${partial.join('') || '<div class="bet-user-card">—</div>'}
                    </div>
                    <div>
                        <div class="bet-column-title" style="color:#e74c3c">❌ Errando (${wrong.length})</div>
                        ${wrong.join('') || '<div class="bet-user-card">—</div>'}
                    </div>
                </div>`;
        } else {
            const isGroupRoundMode =
                !isKnockout &&
                matchObj.phase === 'group' &&
                STATE.groupBetAvailabilityMode === 'round';

            const isVisibleByAdmin = isGroupRoundMode
                ? (
                    Number.isInteger(Number(matchObj.roundNumber)) &&
                    STATE.unlockedGroupRounds.has(Number(matchObj.roundNumber)) &&
                    !STATE.lockedGroupRounds.has(Number(matchObj.roundNumber))
                  )
                : (
                    isKnockout
                        ? unlockedPhases.includes(matchObj.group)
                        : (unlockedPhases.includes('group') ||
                           unlockedPhases.includes(matchObj.group) ||
                           unlockedPhases.includes(matchObj.phaseName))
                  );

            if (!isVisibleByAdmin) {
                htmlResult = `<div class="bet-locked"><div style="font-size:2rem;">🔒</div>Palpites Ocultos.</div>`;
            } else {
                const torcida = { home: [], draw: [], away: [] };
                allBets.forEach(u => {
                    const b = u.bets?.[0];
                    if (b && b.choice) {
                        const normalizedChoice = normalize(b.choice);
                        if (torcida[normalizedChoice]) {
                            torcida[normalizedChoice].push(generateUserCardHtml(u));
                        }
                    }
                });

                htmlResult = `
                    <div class="bet-grid grid-3">
                        <div>
                            <div class="bet-column-title">VITÓRIA ${matchObj.teamA} (${torcida.home.length})</div>
                            ${torcida.home.join('') || '<div class="bet-user-card">—</div>'}
                        </div>
                        <div>
                            <div class="bet-column-title">EMPATE (${torcida.draw.length})</div>
                            ${torcida.draw.join('') || '<div class="bet-user-card">—</div>'}
                        </div>
                        <div>
                            <div class="bet-column-title">VITÓRIA ${matchObj.teamB} (${torcida.away.length})</div>
                            ${torcida.away.join('') || '<div class="bet-user-card">—</div>'}
                        </div>
                    </div>`;
            }
        }

        const content = document.getElementById('detalhes-body-content');
        if (content) {
            content.innerHTML = htmlResult;
        }

        const timelineContainer = document.getElementById('modal-timeline-content') || document.getElementById('match-timeline-content');
        if (timelineContainer) {
            timelineContainer.innerHTML = renderTimelineHTML(matchObj, STATE.allBets);
        }

    } catch (e) { 
        console.error("Erro ao carregar apostas e ranking via backend:", e); 
    }
}

window.renderLineups = function(match) {
    const l = match.lineups;
    
    if (!l || (!l.home && !l.away)) {
        return '<div style="text-align:center;color:#999;padding:30px;font-size:0.8rem;">Escalação ainda não confirmada pela API.</div>';
    }

    const tA = l.home || {}; 
    const tB = l.away || {};

    const renderList = (players, isRight) => {
        if (!players || !players.length) {
            return '<div style="color:#ccc;text-align:center;padding:5px;font-size:0.7rem;">—</div>';
        }

        return players.map(p => {
            const num = p.numero || '';
            const nome = p.nome || 'Jogador';
            const pos = (p.posicao || '').toUpperCase();
            
            const posClass = pos ? `pos-${pos[0]}` : '';

            let icons = '';
            if (p.gols > 0) {
                icons += `<span title="${p.gols} gol(s)" style="margin:0 1px;">⚽<sup style="font-size:7px;">${p.gols > 1 ? p.gols : ''}</sup></span>`;
            }
            if (p.vermelho) {
                icons += `<span style="color:red; font-size:10px; margin:0 1px;">🟥</span>`;
            } else if (p.amarelo) {
                icons += `<span style="color:gold; font-size:10px; margin:0 1px;">🟨</span>`;
            }

            const subMin = p.saiu || p.entrou || p.sub_min;
            if (subMin) {
                const subColor = p.saiu ? '#e53935' : '#43a047';
                icons += `<span class="sub-icon" style="margin:0 1px; color:${subColor}; font-weight:bold;">🔄</span>`;
            }
            
            return `
                <div class="player-row" style="display:flex; align-items:center; gap:3px; padding:4px 0; border-bottom:1px solid #f8f8f8; font-size:0.75rem; width:100%; box-sizing:border-box;">
                    ${isRight ? `
                        <div style="flex:1; display:flex; align-items:center; gap:3px; overflow:hidden; justify-content:flex-end; text-align:right;">
                            <div style="display:inline-flex; align-items:center; flex-shrink:0; gap:1px;">${icons}</div>
                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#333; font-weight:500;">${nome}</span>
                        </div>
                        <span class="${posClass} position-badge" style="flex-shrink:0; margin:0;">${pos}</span>
                        <span class="player-number" style="flex-shrink:0; margin:0;">${num}</span>
                    ` : `
                        <span class="player-number" style="flex-shrink:0; margin:0;">${num}</span>
                        <span class="${posClass} position-badge" style="flex-shrink:0; margin:0;">${pos}</span>
                        <div style="flex:1; display:flex; align-items:center; gap:3px; overflow:hidden;">
                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#333; font-weight:500; ${subMin && p.saiu ? 'opacity:0.7;' : ''}">${nome}</span>
                            <div style="display:inline-flex; align-items:center; flex-shrink:0; gap:1px;">${icons}</div>
                        </div>
                    `}
                </div>`;
        }).join('');
    };

    return `
        <div id="modal-detalhes" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:2px; width:100%; box-sizing:border-box;">
            <div style="border-right: 1px solid #eee; padding-right: 4px; overflow:hidden;">
                <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <span style="font-size:0.65rem; font-weight:800; color:#555; text-transform:uppercase;">TITULARES</span>
                    <div class="formation-badge">${tA.formation || tA.formacao || ''}</div>
                </div>
                ${renderList(tA.titulares || tA.players, false)}
                
                <div class="section-header" style="font-size:0.65rem; font-weight:800; color:#999; margin-top:20px; margin-bottom:10px; text-transform:uppercase;">RESERVAS</div>
                ${renderList(tA.reservas || tA.substitutes, false)}
            </div>

            <div style="padding-left: 4px; overflow:hidden;">
                <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-direction:row-reverse;">
                    <span style="font-size:0.65rem; font-weight:800; color:#555; text-transform:uppercase;">TITULARES</span>
                    <div class="formation-badge">${tB.formation || tB.formacao || ''}</div>
                </div>
                ${renderList(tB.titulares || tB.players, true)}
                
                <div class="section-header" style="font-size:0.65rem; font-weight:800; color:#999; margin-top:20px; margin-bottom:10px; text-align:right; text-transform:uppercase;">RESERVAS</div>
                ${renderList(tB.reservas || tB.substitutes, true)}
            </div>
        </div>`;
};

function toNumber(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;

    if (typeof val === 'string') {
        if (val.includes('(')) {
            const principal = val.split(/[\/\s(]/)[0];
            return parseFloat(principal) || 0;
        }
        const cleaned = val.replace(/[^\d.-]/g, '');
        return parseFloat(cleaned) || 0;
    }

    if (typeof val === 'object') {
        return toNumber(val.total ?? val.value ?? val.all ?? 0);
    }

    return 0;
}

function renderStatRow(label, valA, valB, unit = "") {
    const numA = parseFloat(valA) || 0;
    const numB = parseFloat(valB) || 0;
    const total = (numA + numB) || 1;
    const pA = (numA / total) * 100;

    const styleH = numA > numB ? "font-weight:800; color:#000;" : "font-weight:400; color:#555;";
    const styleA = numB > numA ? "font-weight:800; color:#000;" : "font-weight:400; color:#555;";

    return `
        <div class="stat-row" style="margin-bottom:12px; padding: 0 5px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; margin-bottom:3px;">
                <span style="min-width:35px; ${styleH}">${valA}${unit}</span>
                <span style="color:#999; text-transform:uppercase; font-size:0.6rem; letter-spacing:0.5px; flex:1; text-align:center;">${label}</span>
                <span style="min-width:35px; text-align:right; ${styleA}">${valB}${unit}</span>
            </div>
            <div style="display:flex; height:5px; background:#eee; border-radius:10px; overflow:hidden;">
                <div style="width:${pA}%; background:#333; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                <div style="flex:1; background:#c62828; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
            </div>
        </div>`;
}

function renderAbaEstatisticas(matchId) {
    const match = STATE.matches.find(m => String(m.matchId) === String(matchId));
    
    const statsSource = match?.statistics?.[0] || match?.summary?.stats?.[0];

    if (!match || !statsSource) {
        return '<div style="text-align:center; padding:40px 20px; color:#999; font-size:0.75rem;">Estatísticas técnicas em processamento...</div>';
    }

    const h = statsSource.home || {};
    const a = statsSource.away || {};

    const defensiveActionsH = toNumber(h.tackles_won) + toNumber(h.interceptions);
    const defensiveActionsA = toNumber(a.tackles_won) + toNumber(a.interceptions);

    const calcPassAcc = (obj) => {
        const total = toNumber(obj.passes);
        const acc = toNumber(obj.accurate_passes);
        return total > 0 ? Math.round((acc / total) * 100) : 0;
    };

    const mapaStats = [
        { label: 'Posse de Bola', valH: toNumber(h.ball_possession), valA: toNumber(a.ball_possession), unit: '%' },
        { label: 'xG (Gols Esperados)', valH: toNumber(h.expected_goals), valA: toNumber(a.expected_goals) },
        { label: 'Faltas Cometidas', valH: toNumber(h.fouls), valA: toNumber(a.fouls) },
        { label: 'Total de Chutes', valH: toNumber(h.total_shots), valA: toNumber(a.total_shots) },
        { label: 'Chutes no Gol', valH: toNumber(h.shots_on_target), valA: toNumber(a.shots_on_target) },
        { label: 'Chutes na Trave', valH: toNumber(h.hit_woodwork), valA: toNumber(a.hit_woodwork) },
        { label: 'Grandes Chances', valH: toNumber(h.big_chances), valA: toNumber(a.big_chances) },
        { label: 'Toques na Área', valH: toNumber(h.touches_in_penalty_area), valA: toNumber(a.touches_in_penalty_area) },
        { label: 'Passes Certos', valH: toNumber(h.accurate_passes), valA: toNumber(a.accurate_passes) },
        { label: 'Precisão de Passe', valH: calcPassAcc(h), valA: calcPassAcc(a), unit: '%' },
        { label: 'Ações Defensivas', valH: defensiveActionsH, valA: defensiveActionsA },
        { label: 'Gols Prevenidos', valH: toNumber(h.goals_prevented), valA: toNumber(a.goals_prevented) },
        { label: 'Escanteios', valH: toNumber(h.corner_kicks), valA: toNumber(a.corner_kicks) },
        { label: 'Amarelos', valH: toNumber(h.yellow_cards), valA: toNumber(a.yellow_cards) },
        { label: 'Vermelhos', valH: toNumber(h.red_cards), valA: toNumber(a.red_cards) }
    ];

    let html = `<div style="padding:15px 5px; max-height: 450px; overflow-y: auto; scrollbar-width: none;">`;

    mapaStats.forEach(stat => {
        html += renderStatRow(stat.label, stat.valH, stat.valA, stat.unit || "");
    });

    return html + `</div>`;
}

window.abrirDetalhesPartida = async function (matchId) {
    const matchIdStr = String(matchId);
    
    const m = STATE.matches.find(match => String(match.matchId) === matchIdStr);
    if (!m) return;

    const oldModal = document.getElementById('modal-detalhes');
    if (oldModal) {
        oldModal.remove();
    }

    const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'live', 'prorrogacao', 'penaltis'].some(s => m.status.includes(s));
    const statusText = isLive ? 'AO VIVO' : (m.status === 'finished' ? 'FINALIZADO' : 'AGENDADO');

    const listaDeApostadores = STATE.allBets || [];

    const modalHtml = `
    <div id="modal-detalhes" class="modal-overlay" data-opened-match-id="${matchIdStr}">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">⚽ DETALHES - <span id="modal-status-label">${statusText}</span></h3>
          <button id="btn-fechar-detalhes" class="btn-close-modal">&times;</button>
        </div>
        <div class="modal-body">
          
          <div class="score-card" style="display: flex; align-items: flex-start; justify-content: space-between; width: 100%; padding: 15px 0;">
              <div class="team-box">
                  <div class="modal-flag-container">${renderTeamMedia(m.teamA, m.logoA)}</div>
                  <span class="team-name">${m.teamA}</span>
              </div>
              <div class="score-center">
                  <div id="modal-placar-score" class="score-numbers" style="font-size: 2rem; font-weight: 800;">--</div>
                  <div id="modal-placar-tempo" style="font-size: 0.7rem; color: #666; text-transform: uppercase;"></div>
              </div>
              <div class="team-box">
                  <div class="modal-flag-container">${renderTeamMedia(m.teamB, m.logoB)}</div>
                  <span class="team-name">${m.teamB}</span>
              </div>
          </div>

          <div class="modal-tabs-nav" style="display: flex; gap: 10px; border-bottom: 1px solid #eee; margin-bottom: 15px;">
            <button class="tab-btn active" onclick="switchTab('aba-timeline', event)" style="padding: 10px; cursor: pointer; background: none; border: none; border-bottom: 2px solid #c62828; font-weight: bold;">Timeline</button>
            <button class="tab-btn" onclick="switchTab('aba-estatisticas', event)" style="padding: 10px; cursor: pointer; background: none; border: none; font-weight: bold;">Estatísticas</button>
            <button class="tab-btn" onclick="switchTab('aba-escalacao', event)" style="padding: 10px; cursor: pointer; background: none; border: none; font-weight: bold;">Escalação</button>
          </div>

          <div id="aba-timeline" class="tab-content" style="display: block;">
            <div id="modal-timeline-content" class="timeline-content">
                ${typeof renderTimelineHTML === 'function' 
                    ? renderTimelineHTML(m, listaDeApostadores) 
                    : '<div style="text-align:center; padding:20px; color:#999;">Carregando linha do tempo...</div>'}
            </div>
            <div id="detalhes-body-content" class="bets-container"></div>
          </div>

          <div id="aba-estatisticas" class="tab-content" style="display: none;">
            <div id="stats-render-target"></div>
          </div>

          <div id="aba-escalacao" class="tab-content" style="display: none;">
            <div id="modal-lineups-content">
              ${(m.lineups && typeof window.renderLineups === 'function') 
                  ? window.renderLineups(m) 
                  : '<div class="loading-box" style="text-align:center; padding:30px; color:#999; font-size:0.8rem;">⚽ Buscando escalação confirmada...</div>'}
            </div>
          </div>

        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btn-fechar-detalhes').onclick = () => {
        const modal = document.getElementById('modal-detalhes');
        if (modal) modal.remove();
    };

    window.syncModalData(m);

    if (typeof fetchTechnicalData === 'function') {
        fetchTechnicalData(matchIdStr);
    }

    if (typeof fetchAndRenderBets === 'function') {
        fetchAndRenderBets(m);
    }
};

window.switchTab = function(tabId, event) {
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottom = 'none';
        btn.style.color = '#888';
    });

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.style.display = 'block';

    if (event && event.currentTarget) {
        const btn = event.currentTarget;
        btn.classList.add('active');
        btn.style.borderBottom = '3px solid #c62828';
        btn.style.color = '#c62828';
    }

    if (tabId === 'aba-estatisticas') {
        const matchId = document.getElementById('modal-detalhes')?.getAttribute('data-opened-match-id');
        if (matchId && typeof renderAbaEstatisticas === 'function') {
            document.getElementById('stats-render-target').innerHTML = renderAbaEstatisticas(matchId);
        }
    }
    
    if (tabId === 'aba-escalacao') {
        const matchId = document.getElementById('modal-detalhes')?.getAttribute('data-opened-match-id');
        const m = STATE.matches.find(match => String(match.matchId) === String(matchId));
        if (m && typeof renderLineups === 'function') {
            document.getElementById('modal-lineups-content').innerHTML = renderLineups(m);
        }
    }
};

async function fetchTechnicalData(matchIdStr) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId');
        if (!leagueId) {
            throw new Error('leagueId não encontrado para dados técnicos da partida');
        }
        const response = await api.get(
            `/api/matches/match-technical/${encodeURIComponent(matchIdStr)}?leagueId=${encodeURIComponent(leagueId)}`
        );
        
        if (response?.success) {
            const technicalData = response.data;
            const idx = STATE.matches.findIndex(match => String(match.matchId) === String(matchIdStr));
            
            if (idx !== -1) {
                STATE.matches[idx] = syncScoresWithGoals({ ...STATE.matches[idx], ...technicalData });
                const matchAtualizado = STATE.matches[idx];

                const modalAberto = document.getElementById('modal-detalhes');
                const openedMatchId = modalAberto?.getAttribute('data-opened-match-id');

                if (modalAberto && String(openedMatchId) === String(matchIdStr)) {
                    const lineupsDiv = document.getElementById('modal-lineups-content');
                    if (lineupsDiv && typeof window.renderLineups === 'function') {
                        lineupsDiv.innerHTML = window.renderLineups(matchAtualizado);
                    }

                    const statsDiv = document.getElementById('stats-render-target');
                    if (statsDiv && typeof window.renderAbaEstatisticas === 'function') {
                        statsDiv.innerHTML = window.renderAbaEstatisticas(matchIdStr);
                    }
                    
                    if (typeof window.syncModalData === 'function') {
                        window.syncModalData(matchAtualizado);
                    }
                }
            }
        }
    } catch (e) { 
        console.error("Erro ao buscar dados técnicos da partida " + matchIdStr + ":", e);
    }
}

export async function initMatches(passedOpenedGroups = null) {
  startGroupPredictionPointsLiveRefresh();
  let openedGroups = passedOpenedGroups;

  if (!openedGroups || openedGroups.length === 0) {
    openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
      .map(item => {
        return item.getAttribute('data-group') || item.querySelector('.accordion-title')?.textContent.trim();
      })
      .filter(Boolean);
  }

  const leagueName = localStorage.getItem('selectedLeagueName') || 'Torneio';
  console.log(`🔄 Sincronizando dados do torneio: ${leagueName}...`);

  try {
    await Promise.all([
      loadMatches(),
      loadMyBets(),
      loadOfficialPodium(),
      loadGlobalSettings()
    ]);

    window.STATE = Object.assign(window.STATE || {}, STATE);

    /*
     * Restaura o rascunho local depois de carregar os dados oficiais da liga.
     * Assim o usuário consegue continuar exatamente de onde parou sem
     * substituir o estado oficial salvo no backend.
     */
    try {
      loadLocalDraft();
    } catch (draftError) {
      console.warn('⚠️ Não foi possível restaurar o rascunho local:', draftError);
    }

    console.log(`✅ Dados carregados. Jogos desta liga: ${STATE.matches.length}`);

    const matchWrap = document.getElementById('matches-container');
    const knockoutWrap = document.getElementById('knockout-container');
    
    if (matchWrap) matchWrap.innerHTML = ''; 
    if (knockoutWrap) knockoutWrap.innerHTML = '';
    
    if (typeof renderMatches === 'function') {
  renderMatches(openedGroups);
}

if (typeof renderKnockoutMatches === 'function') {
  renderKnockoutMatches(openedGroups);
}

if (STATE.matches && STATE.matches.length > 0) {

  // ============================
  // EXTRAS
  // ============================
  if (typeof renderExtrasSection === 'function') {
    renderExtrasSection();
  }

  if (typeof updateExtrasPointsDisplay === 'function') {
    updateExtrasPointsDisplay();
  }

  if (typeof fillExtrasInputs === 'function') {
    fillExtrasInputs();
  }

  // ============================
  // PÓDIO
  // ============================
  if (typeof fillPodiumSelects === 'function') {
    fillPodiumSelects();
  }

} else {
  console.warn("⚠️ Pódio/Extras não renderizados: Esta liga não possui jogos cadastrados.");
}

    if (typeof updateBetsCounters === 'function') updateBetsCounters();
    
    if (typeof syncKnockoutSelections === 'function') syncKnockoutSelections();

    console.log(`[Init] Renderização concluída. Mantendo abertos:`, openedGroups);

  } catch (err) {
    console.error("❌ Erro ao inicializar matches:", err);
  }
}

export function updateMatchDom(matchId, rawData) {
  const matchIdStr = String(matchId);
  const matchCard = document.getElementById(`match-${matchIdStr}`);
  
  console.log(`%c [DOM Update] Iniciando atualização para o ID: ${matchIdStr} `, "background: #333; color: #fff; border-radius: 5px;");
  
  if (!matchCard) {
    console.warn(`[DOM Update] ❌ ERRO: Card match-${matchIdStr} não encontrado no documento.`);
    return;
  }

  const data = syncScoresWithGoals(rawData);

  try {
    const rawPrev = matchCard.getAttribute('data-status') || '';
    const previousStatus = rawPrev.toLowerCase().trim() || 'scheduled';
    const newStatus = (data.status || '').toLowerCase().trim();
    
    const phaseAttr = (matchCard.getAttribute('data-phase') || 'group').toLowerCase();
    const isKnockout = phaseAttr === 'knockout' || 
                       phaseAttr === 'mata-mata' || 
                       phaseAttr === 'eliminatória' ||
                       (typeof isKnockoutMatch === 'function' && isKnockoutMatch(data));
    
    const isStatusChanging = previousStatus !== newStatus;
    const isBeforeStart = (s) => s === 'scheduled' || s === 'agendado' || s === '' || s === 'vazio';
    
    const startedNow = isBeforeStart(previousStatus) && !isBeforeStart(newStatus) && isStatusChanging;
    const enteredPenalties = (previousStatus !== 'penaltis' && newStatus === 'penaltis' && isStatusChanging);
    const justFinished = (previousStatus !== 'finished' && newStatus === 'finished' && isStatusChanging);
    const needsPenaltiesUI = newStatus === 'penaltis' && !matchCard.querySelector('.pen-a-val');

    if (startedNow || enteredPenalties || justFinished || needsPenaltiesUI) {
      matchCard.setAttribute('data-status', newStatus);

      const openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
        .map(item => item.querySelector('.accordion-title')?.textContent.trim())
        .filter(Boolean);

      const currentGroupTitle = matchCard.closest('.accordion-item')?.querySelector('.accordion-title')?.textContent.trim();
      if (startedNow && currentGroupTitle && !openedGroups.includes(currentGroupTitle)) {
        openedGroups.push(currentGroupTitle);
      }

      if (typeof initMatches === 'function') {
        setTimeout(() => { 
          initMatches(openedGroups); 
        }, 800);
        return; 
      }
    }

    const scoreAEl = matchCard.querySelector('.score-a-val');
    const scoreBEl = matchCard.querySelector('.score-b-val');

    if (scoreAEl && scoreBEl && (data.scoreA !== undefined || data.scoreB !== undefined)) {
      const oldScoreA = Number(scoreAEl.textContent || 0);
      const oldScoreB = Number(scoreBEl.textContent || 0);
      const newScoreA = Number(data.scoreA ?? oldScoreA);
      const newScoreB = Number(data.scoreB ?? oldScoreB);

      if (newScoreA > oldScoreA || newScoreB > oldScoreB) {
        console.log(`%c [GOOOL!] Alerta disparado: ${newScoreA}x${newScoreB} `, "background: #f00; color: #fff;");
        const oldMatchData = {
          scoreA: oldScoreA,
          scoreB: oldScoreB,
          teamA: matchCard.getAttribute('data-team-a') || 'Time A',
          teamB: matchCard.getAttribute('data-team-b') || 'Time B'
        };
        if (typeof alertGoal === 'function') alertGoal(matchId, data, oldMatchData);
      }
      
      scoreAEl.textContent = newScoreA;
      scoreBEl.textContent = newScoreB;

      // ===== RECALCULA PONTOS PARCIAIS AO VIVO =====
      const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];
      if (liveStatuses.includes(newStatus)) {
  const mIdx = STATE.matches.findIndex(
    m => String(m.matchId) === matchIdStr
  );

  let liveMatch;

  if (mIdx !== -1) {
    STATE.matches[mIdx] = {
      ...STATE.matches[mIdx],
      ...data
    };

    liveMatch = STATE.matches[mIdx];
  } else {
    liveMatch = {
      ...data,
      matchId
    };
  }

  // Atualiza a cor do palpite em tempo real
  refreshPredictionScoreInputs(liveMatch);

  const liveResult = calcLivePoints(liveMatch);

  // Atualiza ou cria a linha de pontos parciais
  let pointsEl =
    matchCard.querySelector('.points-earned.partial');

  if (!pointsEl) {
    pointsEl = document.createElement('div');
    pointsEl.className = 'points-earned partial';
    matchCard.appendChild(pointsEl);
  }

  if (liveResult.points > 0) {
    pointsEl.textContent =
      `+${liveResult.points} pts (parcial)`;
    pointsEl.style.display = '';
  } else {
    pointsEl.style.display = 'none';
  }
}
    }

    if (data.goalsDetail && Array.isArray(data.goalsDetail)) {
      const getGolsHtml = (side) => {
        return data.goalsDetail
          .filter(g => g.side === side && (g.type === 'goal' || g.type === 'own-goal' || !g.type))
          .map(g => `
            <div class="goal-entry-card" style="font-size: 0.62rem; color: #ffca28; font-weight: bold; text-shadow: 1px 1px 2px #000; text-align: center; pointer-events: none; line-height: 1.1; margin-bottom: 2px; animation: fadeIn 0.5s;">
              ⚽ ${g.name || g.player} ${g.min}'
            </div>`)
          .join('');
      };

      const optionWrappers = matchCard.querySelectorAll('.option-wrapper');
      optionWrappers.forEach(wrapper => {
        const btn = wrapper.querySelector('button');
        if (!btn) return;
        const choice = btn.getAttribute('data-choice');
        const container = wrapper.querySelector('.gols-indicator-container');
        if (container) {
          if (choice === 'A') container.innerHTML = getGolsHtml('home');
          else if (choice === 'B') container.innerHTML = getGolsHtml('away');
          else container.innerHTML = '';
        }
      });
    }

    const penAEl = matchCard.querySelector('.pen-a-val');
    const penBEl = matchCard.querySelector('.pen-b-val');
    if (data.hasOwnProperty('penaltiesA') && penAEl && penBEl) {
      penAEl.textContent = data.penaltiesA;
      penBEl.textContent = data.penaltiesB;
    }

    // --- ATUALIZAÇÃO DINÂMICA DO SHOTMAP ---
    const isPenaltiesCurrent = newStatus === 'penaltis' || newStatus === 'penalties' || data.isPenalties || previousStatus === 'penaltis';
    let shotmapContainer = matchCard.querySelector('.penalty-shotmap-container');
    
    if (isPenaltiesCurrent) {
      if (!shotmapContainer) {
        shotmapContainer = document.createElement('div');
        shotmapContainer.className = 'penalty-shotmap-container';
        shotmapContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0, 0, 0, 0.04); border-radius: 8px; margin-top: 12px; margin-bottom: 8px; border: 1px dashed rgba(46, 204, 113, 0.3);';
        
        const betOptions = matchCard.querySelector('.bet-options');
        if (betOptions && betOptions.nextSibling) {
            betOptions.parentNode.insertBefore(shotmapContainer, betOptions.nextSibling);
        } else {
            matchCard.appendChild(shotmapContainer);
        }
      }

      let seqA = [];
      let seqB = [];
      const shootoutDetail = data.shootoutDetail || STATE.matches.find(m => String(m.matchId) === matchIdStr)?.shootoutDetail;

      if (shootoutDetail) {
        if (Array.isArray(shootoutDetail)) {
          shootoutDetail.forEach(item => {
            const isHome = item.home === true || item.team === 'A' || item.team === 'home' || item.team === 'teamA';
            const isConverted = item.type === 'goal' || item.converted === true || item.success === true || item.status === 'score';
            if (isHome) seqA.push(isConverted);
            else seqB.push(isConverted);
          });
        } else if (typeof shootoutDetail === 'object') {
          seqA = shootoutDetail.teamA || shootoutDetail.home || [];
          seqB = shootoutDetail.teamB || shootoutDetail.away || [];
        }
      }

      shotmapContainer.innerHTML = `
        <div class="shotmap-side shotmap-home" style="display: flex; gap: 5px;">${generateShotmapDots(seqA)}</div>
        <span style="font-size: 10px; font-weight: 800; color: #7f8c8d; letter-spacing: 0.5px; text-transform: uppercase;">Série</span>
        <div class="shotmap-side shotmap-away" style="display: flex; gap: 5px;">${generateShotmapDots(seqB)}</div>
      `;
      shotmapContainer.style.display = 'flex';
    } else if (shotmapContainer) {
      shotmapContainer.style.display = 'none';
    }
    // ----------------------------------------

    const minuteEl = matchCard.querySelector('.live-minute-inline');
    if (minuteEl && data.minute !== undefined) {
      const minVal = String(data.minute).trim();
      if (minVal && minVal !== '0' && minVal !== 'null' && minVal !== '') {
        minuteEl.textContent = minVal.includes("'") ? minVal : minVal + "'";
        minuteEl.style.display = "inline-block";
      } else {
        minuteEl.textContent = "";
      }
    }

    const badge = matchCard.querySelector('.badge');
    if (badge && newStatus) {
      const label = (typeof statusLabel === 'function') ? statusLabel(newStatus) : newStatus;
      badge.textContent = label;
      badge.className = `badge ${newStatus}`;
    }

    if (newStatus === 'finished') {
      matchCard.setAttribute('data-status', 'finished');
      if (minuteEl) minuteEl.textContent = "";
      return; 
    }

    const norm = (v) => {
        const s = String(v || '').trim().toLowerCase();
        if (s === 'a' || s === 'home') return 'home';
        if (s === 'b' || s === 'away') return 'away';
        if (s === 'draw' || s === 'x') return 'draw';
        return s;
    };

    const bVal = window.STATE?.betsMap?.get(Number(matchId)) || window.STATE?.betsMap?.get(String(matchId));
    const userBet = norm(bVal?.choice || bVal);

    if (userBet || isKnockout) {
      matchCard.classList.remove('live-winning', 'live-losing', 'live-winning-full', 'live-winning-partial');

      // ===== NOVO: Usa calcLivePoints para determinar classe visual =====
      const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];
      if (liveStatuses.includes(newStatus)) {
        const mIdx = STATE.matches.findIndex(m => String(m.matchId) === matchIdStr);
        const matchData = mIdx !== -1 ? { ...STATE.matches[mIdx], ...data } : data;
        const liveResult = calcLivePoints(matchData);
        const hasBet = Boolean(userBet || window.STATE?.knockoutQualifiers?.get(Number(matchId)) || window.STATE?.knockoutQualifiers?.get(String(matchId)));

        if (liveResult.points > 0 && hasBet) {
          if (isKnockout && liveResult.breakdown.qualifier > 0 && liveResult.breakdown.winner > 0) {
            matchCard.classList.add('live-winning-full');
          } else {
            matchCard.classList.add('live-winning-partial');
          }
        } else if (hasBet) {
          matchCard.classList.add('live-losing');
        }
      }
    }

    matchCard.setAttribute('data-status', newStatus);

    const modal = document.getElementById('modal-detalhes');
    if (modal && modal.dataset.openedMatchId === matchIdStr) {
        const mIdx = STATE.matches.findIndex(m => String(m.matchId) === matchIdStr);
        if (mIdx !== -1) {
            STATE.matches[mIdx] = { ...STATE.matches[mIdx], ...data };
            const matchFullData = STATE.matches[mIdx];
            console.log(`[SSE-Fix] Evento Live! Disparando atualização do modal e do ranking...`);

            if (typeof window.syncModalData === 'function') {
                window.syncModalData(matchFullData);
            } else if (typeof fetchAndRenderBets === 'function') {
                fetchAndRenderBets(matchFullData);
            }
        }
    }

  } catch (err) {
    console.error(`[DOM Update] Falha no ID ${matchIdStr}:`, err);
  }
}

export function alertGoal(matchId, data, oldMatch) {
  console.group(`🚨 INVESTIGAÇÃO DE GOL - ID: ${matchId}`);
  
  console.log("📥 Dados recebidos (data):", data);
  console.log("🏠 Dados antigos (oldMatch):", oldMatch);

  const scoreANovo = Number(data.scoreA ?? oldMatch.scoreA);
  const scoreAAntigo = Number(oldMatch.scoreA);
  const scoreBNovo = Number(data.scoreB ?? oldMatch.scoreB);
  const scoreBAntigo = Number(oldMatch.scoreB);

  const golTimeA = scoreANovo > scoreAAntigo;
  const golTimeB = scoreBNovo > scoreBAntigo;
  
  const bNum = window.STATE?.betsMap?.get(Number(matchId));
  const bStr = window.STATE?.betsMap?.get(String(matchId));
  const rawBet = bNum || bStr;

  const userBet = (rawBet && typeof rawBet === 'object') ? rawBet.choice : rawBet;

  let tipoToast = "info";
  let motivoCausa = "Nenhuma aposta encontrada";

  if (userBet) {
    if (userBet === 'draw' || userBet === 'empate') {
      tipoToast = "info";
      motivoCausa = "Aposta em empate (Neutro)";
    } else if (golTimeA) {
      tipoToast = (userBet === 'A' || userBet === 'home') ? "success" : "danger";
      motivoCausa = `Gol do Time A + Aposta em ${userBet}`;
    } else if (golTimeB) {
      tipoToast = (userBet === 'B' || userBet === 'away') ? "success" : "danger";
      motivoCausa = `Gol do Time B + Aposta em ${userBet}`;
    }
  }

  const bandeira = golTimeA ? flagOnly(oldMatch.teamA) : flagOnly(oldMatch.teamB);
  const nomeTime = (golTimeA ? oldMatch.teamA : oldMatch.teamB) || 'Time';
  const msg = `⚽ GOL ⚽ ${bandeira} ${nomeTime.toUpperCase()}!`;

  if (typeof toast === 'function') {
    toast(msg, tipoToast);
  } else {
    console.error("❌ ERRO CRÍTICO: Função 'toast' não está acessível!");
  }

  console.groupEnd();
}

/* =========================================================================
   🚀 NOVAS FUNÇÕES GLOBAIS DE EDIÇÃO INDIVIDUAL (Adicionadas no Escopo Window)
========================================================================= */

window.unlockMatchForEdit = function(matchId, event) {
  if (event) event.stopPropagation();
  
  const idNum = Number(matchId);

  // Inicializa a proteção de variável caso esteja indefinida
  if (!window.STATE.editingMatches) window.STATE.editingMatches = new Set();

  // Adiciona no modo de edição e remove do bloqueio
  window.STATE.editingMatches.add(idNum);
  window.STATE.lockedMatches.delete(idNum);
  window.STATE.lockedMatches.delete(String(matchId));

  // Avisa o usuário sutilmente (se tiver UI instalada)
  if (typeof toast === 'function') toast('Card destravado! Altere seu palpite e clique em Salvar.', 'info');

  // Pega os grupos abertos pra não fechar o accordion bruscamente
  const openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
      .map(item => item.getAttribute('data-group'))
      .filter(Boolean);

  // Re-renderiza a tela para desbloquear os botões de aposta e trocar Editar > Salvar
  if (typeof renderMatches === 'function') renderMatches(openedGroups);
  if (typeof renderKnockoutMatches === 'function') renderKnockoutMatches(openedGroups);
};

window.saveSingleBet = async function(matchId, event) {
  if (event) event.stopPropagation();
  
  const idNum = Number(matchId);
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;
  
  // Feedback Visual de Carregamento
  btn.innerHTML = '⏳...';
  btn.disabled = true;

  try {
    const choice = window.STATE.betsMap.get(idNum) || window.STATE.betsMap.get(String(matchId));
    const qualifier = window.STATE.knockoutQualifiers.get(idNum) || window.STATE.knockoutQualifiers.get(String(matchId));
    const scoreData = window.STATE.scoresMap.get(idNum) || window.STATE.scoresMap.get(String(matchId)) || { scoreA: null, scoreB: null };
    const leagueId = localStorage.getItem('selectedLeagueId');

    // Chamada real da API
    const res = await api.post(`/api/bets/single`, { 
      leagueId, 
      matchId: idNum, 
      winner: choice, 
      qualifier,
      scoreA: scoreData.scoreA,
      scoreB: scoreData.scoreB
    });

    if (!res?.success) throw new Error(res?.message || 'Erro ao salvar palpite');

    // Remove do estado de Edição e joga de volta pro bloqueio
    window.STATE.editingMatches.delete(idNum);
    window.STATE.lockedMatches.add(idNum);
    window.STATE.lockedMatches.add(String(matchId));
    
    if (typeof toast === 'function') toast('Palpite salvo com sucesso!', 'success');

    // Re-renderiza para trocar o botão Salvar > Editar e travar os botões do palpite
    const openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
        .map(item => item.getAttribute('data-group'))
        .filter(Boolean);

    if (typeof renderMatches === 'function') renderMatches(openedGroups);
    if (typeof renderKnockoutMatches === 'function') renderKnockoutMatches(openedGroups);
    
  } catch (error) {
    console.error("Erro ao salvar palpite isolado:", error);
    if (typeof toast === 'function') toast('Erro ao salvar o palpite. Tente novamente.', 'danger');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};
/* ========================================================================= */

document.addEventListener('click', function(e) {

    // Elementos que NÃO devem abrir os detalhes da partida
    if (
        e.target.closest('.bet-option') ||
        e.target.closest('.score-input') ||
        e.target.closest('.score-inputs-row') ||
        e.target.closest('select') ||
        e.target.closest('.btn-edit-bet') ||
        e.target.closest('.btn-save-bet')
    ) {
        return;
    }

    const card = e.target.closest('.match-card');

    if (card) {
        const matchId = card.getAttribute('data-match-id');

        if (
            matchId &&
            typeof window.abrirDetalhesPartida === 'function'
        ) {
            window.abrirDetalhesPartida(matchId);
        }
    }
});

(function() {
    const syncEngravedFlags = () => {
        const selects = document.querySelectorAll('select[data-q]');
        if (!selects.length) return;

        requestAnimationFrame(() => {
            selects.forEach(sel => {
                const wrapper = sel.parentElement;
                let visual = wrapper.querySelector('.engraved-real-flag');
                
                if (!visual) {
                    if (getComputedStyle(wrapper).position === 'static') {
                        wrapper.style.position = 'relative';
                    }
                    visual = document.createElement('div');
                    visual.className = 'engraved-real-flag';
                    visual.style.position = 'absolute';
                    visual.style.left = '8px';
                    visual.style.top = '0px';
                    visual.style.height = '100%';
                    visual.style.pointerEvents = 'none';
                    visual.style.display = 'flex';
                    visual.style.alignItems = 'center';
                    visual.style.justifyContent = 'center';
                    wrapper.appendChild(visual);
                }

                const matchId = sel.dataset.q;
                const m = window.STATE?.matches?.find(match => String(match.matchId) === String(matchId));

                if (sel.value && m) {
                    const teamName = sel.value === 'A' ? m.teamA : m.teamB;
                    const logoUrl = sel.value === 'A' ? m.logoA : m.logoB;
                    
                    visual.innerHTML = renderTeamMedia(teamName, logoUrl);
                    visual.style.display = 'flex';
                } else {
                    visual.innerHTML = '';
                    visual.style.display = 'none';
                }
            });
        });
    };

    window.syncEngravedFlags = syncEngravedFlags;

    document.addEventListener('change', function(e) {
        if (e.target.matches('select[data-q]')) {
            syncEngravedFlags();
        }
    });

    window.addEventListener('resize', syncEngravedFlags);
})();
