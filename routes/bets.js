const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

const router = express.Router();

/* ================================================================
   🛠️ HELPERS & CONSTANTES
   ================================================================ */

function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

function parseMatchDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
}

function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  if (choice === 'draw') return 'Empate';
  return '-';
}

function strMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Fallbacks de segurança (espelhados do pointsService)
const DEFAULT_SCORING = {
  exactScore: 5,
  scoreTeamA: 1,
  scoreTeamB: 1,
  winner: 2,
  qualifier: 3,
  topScorer: 10,
  bestAttack: 10,
  worstDefense: 10,
  upset: 15,
  podiumPoints: [20, 15, 10, 5]
};

const DEFAULT_CHAMPIONSHIP_RULES = {
  drawIncludesExtraTime: false,
  podiumSize: 4
};

// ---------- CÁLCULO DINÂMICO DE PONTOS (alinhado com pointsService) ----------

function getMatchWinnerForBet(match, drawIncludesExtraTime) {
  if (match.status !== 'finished' && !match.isSimulated) return null;

  if (drawIncludesExtraTime) {
    if (match.scoreA == null || match.scoreB == null) return null;
    if (match.scoreA > match.scoreB) return 'A';
    if (match.scoreB > match.scoreA) return 'B';
    return 'draw';
  }

  let a = match.regularTimeScoreA;
  let b = match.regularTimeScoreB;
  if (a == null || b == null) {
    a = match.scoreA;
    b = match.scoreB;
  }
  if (a == null || b == null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

function calcMatchPoints(betMatch, realMatch, rules, champRules, isPartial = false) {
  const breakdown = {
    exactScore: 0,
    scoreTeamA: 0,
    scoreTeamB: 0,
    winner: 0,
    qualifier: 0
  };

  if (!realMatch) {
    return { points: 0, breakdown };
  }

  const isFinished = realMatch.status === 'finished' || realMatch.isSimulated;

  // Modo definitivo: só calcula se finished/simulated
  if (!isPartial && !isFinished) {
    return { points: 0, breakdown };
  }

  // Se não está finished e não é parcial → 0 pts
  if (!isFinished && !isPartial) {
    return { points: 0, breakdown };
  }

  const drawIncludesExtraTime = champRules?.drawIncludesExtraTime ?? false;

  let realA, realB, realWinner, realQualifier;

  // ===== PLACAR DE REFERÊNCIA (respeita drawIncludesExtraTime em AMBOS os modos) =====
  realA = realMatch.scoreA;
  realB = realMatch.scoreB;

  if (!drawIncludesExtraTime) {
    // Se drawIncludesExtraTime=false, prioriza placar do tempo normal
    if (realMatch.regularTimeScoreA != null) realA = realMatch.regularTimeScoreA;
    if (realMatch.regularTimeScoreB != null) realB = realMatch.regularTimeScoreB;
  }

  // Se ainda não temos placar válido (ex: jogo ainda não começou)
  if (realA == null || realB == null) {
    return { points: 0, breakdown };
  }

  // ===== VENCEDOR =====
  if (realA > realB) realWinner = 'A';
  else if (realB > realA) realWinner = 'B';
  else realWinner = 'draw';

  // ===== CLASSIFICADO (mata-mata) =====
  const isKnockout = realMatch.phase === 'knockout' || realMatch.phase === 'mata-mata';
  if (isKnockout) {
    if (isFinished) {
      // Modo definitivo: usa qualifiedSide do backend (já resolvido pelo hook pre-save)
      realQualifier = realMatch.qualifiedSide || null;
    } else {
      // Modo parcial: deriva do placar ao vivo (mesma lógica do frontend)
      const pA = realMatch.penaltiesA;
      const pB = realMatch.penaltiesB;
      if (pA != null && pB != null && pA !== pB) {
        realQualifier = pA > pB ? 'A' : 'B';
      } else if (realA !== realB) {
        realQualifier = realA > realB ? 'A' : 'B';
      } else {
        realQualifier = null;
      }
    }
  } else {
    realQualifier = null;
  }

  // ===== CÁLCULO DE PONTOS =====
  const isExact = (betMatch.scoreA === realA && betMatch.scoreB === realB);

  if ((rules.exactScore || 0) > 0 && isExact) breakdown.exactScore = rules.exactScore;
  if ((rules.scoreTeamA || 0) > 0 && betMatch.scoreA === realA) breakdown.scoreTeamA = rules.scoreTeamA;
  if ((rules.scoreTeamB || 0) > 0 && betMatch.scoreB === realB) breakdown.scoreTeamB = rules.scoreTeamB;
  if ((rules.winner || 0) > 0 && betMatch.winner && betMatch.winner === realWinner) breakdown.winner = rules.winner;
  if ((rules.qualifier || 0) > 0 && realQualifier && betMatch.qualifier && realQualifier === betMatch.qualifier) {
    breakdown.qualifier = rules.qualifier;
  }

  const points = Object.values(breakdown).reduce((s, v) => s + (v || 0), 0);
  return { points, breakdown };
}

function calcPodiumPoints(betPodiumArr, officialPodiumArr, podiumPointsArr, podiumSize = 4) {
  const size = Math.max(
    Math.min(betPodiumArr?.length || 0, podiumSize),
    Math.min(officialPodiumArr?.length || 0, podiumSize),
    Math.min(podiumPointsArr?.length || 0, podiumSize)
  );
  const breakdown = new Array(size).fill(0);

  for (let i = 0; i < size; i++) {
    const pts = podiumPointsArr?.[i] || 0;
    if (pts > 0 && strMatch(betPodiumArr?.[i], officialPodiumArr?.[i])) {
      breakdown[i] = pts;
    }
  }

  const points = breakdown.reduce((s, v) => s + (v || 0), 0);
  return { points, breakdown: breakdown.slice(0, size) };
}

function calcExtrasPoints(betExtras, champResults, rules) {
  const breakdown = { topScorer: 0, bestAttack: 0, worstDefense: 0, upset: 0 };

  if ((rules.topScorer || 0) > 0 && strMatch(betExtras?.topScorer, champResults?.topScorer)) {
    breakdown.topScorer = rules.topScorer;
  }
  if ((rules.bestAttack || 0) > 0 && strMatch(betExtras?.bestAttack, champResults?.bestAttack)) {
    breakdown.bestAttack = rules.bestAttack;
  }
  if ((rules.worstDefense || 0) > 0 && strMatch(betExtras?.worstDefense, champResults?.worstDefense)) {
    breakdown.worstDefense = rules.worstDefense;
  }
  if ((rules.upset || 0) > 0 && strMatch(betExtras?.upset, champResults?.upset)) {
    breakdown.upset = rules.upset;
  }

  const points = Object.values(breakdown).reduce((s, v) => s + (v || 0), 0);
  return { points, breakdown };
}

// Calcula pontuação total de um bet baseado no estado atual das partidas
function computeBetTotal(bet, matchMap, settings, isPartial = false) {
  const rules = { ...DEFAULT_SCORING, ...(settings?.scoringRules || {}) };
  const champRules = { ...DEFAULT_CHAMPIONSHIP_RULES, ...(settings?.championshipRules || {}) };
  const champResults = settings?.championshipResults || {};
  const officialPodium = settings?.podium || [];

  let groupPoints = 0;
  let groupPhasePoints = 0;
  let knockoutPoints = 0;

  (bet.groupMatches || []).forEach(gm => {
    const m = matchMap.get(String(gm.matchId));
    if (!m) return;

    const consider = isPartial
      ? (m.status !== 'scheduled' || m.isSimulated)
      : (m.status === 'finished' || m.isSimulated);

    if (!consider) return;

    const { points } = calcMatchPoints(gm, m, rules, champRules, isPartial);
    groupPoints += points;

    if (m.phase === 'group' || m.phase === 'pontos_corridos') groupPhasePoints += points;
    else knockoutPoints += points;
  });

  const podiumSize = champRules.podiumSize ?? 4;
  const podCalc = calcPodiumPoints(bet.podium || [], officialPodium, rules.podiumPoints || [], podiumSize);
  const extCalc = calcExtrasPoints(bet.extras || {}, champResults, rules);

  const totalPoints = groupPoints + podCalc.points + extCalc.points + (bet.bonusPoints || 0);

  return {
    totalPoints,
    groupPoints,
    groupPhasePoints,
    knockoutPoints,
    podiumPoints: podCalc.points,
    extrasPoints: extCalc.points,
    bonusPoints: bet.bonusPoints || 0,
    lastUpdate: bet.lastUpdate
  };
}

// ---------- HELPERS DO LEADERSHIP-PATH ----------

const getMatchResult = (a, b) => {
  if (a === undefined || b === undefined || a === null || b === null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
};

const getQualifiedSide = (match, matchResult) => {
  if (match.qualifiedSide) return match.qualifiedSide;
  if (match.penaltiesA != null && match.penaltiesB != null) {
    if (match.penaltiesA > match.penaltiesB) return 'A';
    if (match.penaltiesB > match.penaltiesA) return 'B';
  }
  return matchResult && matchResult !== 'draw' ? matchResult : null;
};

const sortMatchesChronologically = (a, b) => {
  const parseDate = (dStr) => {
    if (!dStr) return '1970-01-01';
    if (dStr.includes('/')) {
      const [day, month, year] = dStr.split('/');
      return `${year}-${month}-${day}`;
    }
    return dStr;
  };
  const dateA = new Date(`${parseDate(a.date)}T${a.time || '00:00'}`);
  const dateB = new Date(`${parseDate(b.date)}T${b.time || '00:00'}`);

  if (dateA - dateB !== 0) return dateA - dateB;
  const idA = parseInt(String(a.matchId).replace(/\D/g, ''), 10) || 0;
  const idB = parseInt(String(b.matchId).replace(/\D/g, ''), 10) || 0;
  return idA - idB;
};

/* ================================================================
   🚀 GET /leadership-path
   ================================================================ */

router.get('/leadership-path', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId, userId: targetUserId, mode, simulations, miracle } = req.query;

    console.log('\n--- 🚀 [INÍCIO DEBUG LEADERSHIP-PATH] ---');

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    const isMiracleMode = miracle === 'true';
    const isLive = mode === 'live';
    const loggedInUserId = req.user._id.toString();
    const activeUserId = (targetUserId || loggedInUserId).toString();
    const isViewingSelf = activeUserId === loggedInUserId;
    const isAdmin = req.user?.isAdmin === true;

    const configId = toLeagueId(leagueId);

    const [settings, matches, bets] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: toLeagueId(leagueId) })
        .select('matchId date time status scoreA scoreB regularTimeScoreA regularTimeScoreB penaltiesA penaltiesB phase teamA teamB logoA logoB group qualifiedSide')
        .lean(),
      Bet.find({ hasSubmitted: true, $or: [{ leagueId: lIdStr }, { leagueId: lIdNum }] })
        .select('user groupMatches matchId podium extras bonusPoints')
        .populate('user', 'name')
        .lean()
    ]);

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Configurações da liga não encontradas' });
    }

    const scoringRules = { ...DEFAULT_SCORING, ...(settings.scoringRules || {}) };
    const champRules = { ...DEFAULT_CHAMPIONSHIP_RULES, ...(settings.championshipRules || {}) };
    const champResults = settings.championshipResults || {};
    const officialPodium = settings.podium || [];
    const podiumSize = champRules.podiumSize ?? 4;
    const podiumPointsArr = scoringRules.podiumPoints || [];
    const maxPointsPerMatch =
      (scoringRules.exactScore || 0) +
      (scoringRules.scoreTeamA || 0) +
      (scoringRules.scoreTeamB || 0) +
      (scoringRules.winner || 0) +
      (scoringRules.qualifier || 0);

    let parsedSimulations = {};
    if (mode === 'simulacao' && simulations && simulations.length < 50000) {
      try {
        parsedSimulations = JSON.parse(simulations);
        matches.forEach(m => {
          const midStr = String(m.matchId);
          const simData = parsedSimulations[midStr];
          if (simData && m.status !== 'finished') {
            const winner = simData.winner?.toLowerCase();
            const qualifier = simData.qualifier?.toUpperCase();

            if (winner || qualifier) {
              m.isSimulated = true;
              if (winner === 'a') {
                m.scoreA = simData.scoreA ?? 2;
                m.scoreB = simData.scoreB ?? 0;
              } else if (winner === 'b') {
                m.scoreA = simData.scoreA ?? 0;
                m.scoreB = simData.scoreB ?? 2;
              } else if (winner === 'draw') {
                m.scoreA = simData.scoreA ?? 1;
                m.scoreB = simData.scoreB ?? 1;
              }

              if (m.regularTimeScoreA == null) m.regularTimeScoreA = m.scoreA;
              if (m.regularTimeScoreB == null) m.regularTimeScoreB = m.scoreB;

              if (qualifier === 'A') m.qualifiedSide = 'A';
              if (qualifier === 'B') m.qualifiedSide = 'B';
            }
          }
        });
      } catch (err) {
        console.error('❌ Erro de Parsing no Modo Simulação:', err);
      }
    }

    const unlockedPhases = settings?.unlockedPhases || [];
    const dynamicPodium = [...officialPodium];

    const betsByUserMap = new Map(bets.filter(b => b.user?._id).map(b => [b.user._id.toString(), b]));
    const matchMap = new Map(matches.map(m => [String(m.matchId), m]));
    const matchIdsDaLiga = new Set(matchMap.keys());
    const eliminatedTeams = new Set();

    const targetBet = betsByUserMap.get(activeUserId);
    if (!targetBet) return res.status(404).json({ success: false, message: 'Aposta não encontrada' });

    /**
     * 🆕 CORREÇÃO CRÍTICA: Deriva winner e qualifier automaticamente a partir
     * do placar (scoreA/scoreB) quando o usuário preencheu apenas o placar
     * e deixou winner/qualifier em branco (comum no mata-mata).
     */
    function derivePickFromScores(pick) {
      const derived = { ...pick };
      const a = derived.scoreA;
      const b = derived.scoreB;

      // Deriva winner se não estiver presente mas scores forem números válidos
      if (!derived.winner && typeof a === 'number' && typeof b === 'number') {
        derived.winner = a > b ? 'A' : b > a ? 'B' : 'draw';
      }

      // Deriva qualifier no mata-mata se não estiver presente mas winner estiver definido
      if (!derived.qualifier && derived.winner && derived.winner !== 'draw') {
        derived.qualifier = derived.winner;
      }

      return derived;
    }

    const targetPicksMap = new Map();
    (targetBet.groupMatches || []).forEach(gm => {
      if (matchIdsDaLiga.has(String(gm.matchId))) {
        const rawPick = {
          winner: gm.winner,
          qualifier: gm.qualifier,
          scoreA: gm.scoreA,
          scoreB: gm.scoreB
        };
        targetPicksMap.set(String(gm.matchId), derivePickFromScores(rawPick));
      }
    });

    const knockoutQuotas = { '16-avos de final': 16, 'Oitavas de final': 8, 'Quartas de final': 4, 'Semifinal': 2, '3º lugar': 1, 'Final': 1 };
    let initialKnockoutGroup = null;
    let requiredMatchCount = 0;

    matches.forEach(m => {
      const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
      if (isKnockoutPhase && knockoutQuotas[m.group] > requiredMatchCount) {
        requiredMatchCount = knockoutQuotas[m.group];
        initialKnockoutGroup = m.group;
      }
    });

    if (initialKnockoutGroup && requiredMatchCount > 0) {
      const initialMatches = matches.filter(m => (m.phase === 'knockout' || m.phase === 'mata-mata') && m.group === initialKnockoutGroup);
      if (initialMatches.length === requiredMatchCount) {
        const teamsInKnockout = new Set();
        initialMatches.forEach(m => {
          if (m.teamA) teamsInKnockout.add(m.teamA);
          if (m.teamB) teamsInKnockout.add(m.teamB);
        });
        matches.forEach(m => {
          if (m.phase === 'group') {
            if (m.teamA && !teamsInKnockout.has(m.teamA)) eliminatedTeams.add(m.teamA);
            if (m.teamB && !teamsInKnockout.has(m.teamB)) eliminatedTeams.add(m.teamB);
          }
        });
      }
    }

    const liveStatuses = ['ao_vivo', '1_tempo', '2_tempo', 'intervalo', 'prorrogacao', '1_tet', '2_tet', 'penaltis', 'live', 'in_progress'];

    const semiWinners = new Set();
    const semiLosers = new Set();
    const finalWinners = new Set();
    const finalLosers = new Set();
    const thirdWinners = new Set();
    const thirdLosers = new Set();

    matches.forEach(m => {
      if (['Semifinal', 'Final', '3º lugar'].includes(m.group)) {
        const isMatchValid = isLive ? (m.status !== 'scheduled' || m.isSimulated) : (m.status === 'finished' || m.isSimulated);

        if (isMatchValid) {
          const realWinner = getMatchResult(m.scoreA, m.scoreB);
          const realQual = getQualifiedSide(m, realWinner);

          let winnerTeam = null;
          let loserTeam = null;

          if (realQual === 'A') {
            winnerTeam = m.teamA;
            loserTeam = m.teamB;
          } else if (realQual === 'B') {
            winnerTeam = m.teamB;
            loserTeam = m.teamA;
          } else if (isLive && liveStatuses.includes(m.status)) {
            if (m.scoreA > m.scoreB) { winnerTeam = m.teamA; loserTeam = m.teamB; }
            else if (m.scoreB > m.scoreA) { winnerTeam = m.teamB; loserTeam = m.teamA; }
          }

          if (winnerTeam && loserTeam) {
            if (m.group === 'Semifinal') {
              semiWinners.add(winnerTeam);
              semiLosers.add(loserTeam);
            } else if (m.group === 'Final') {
              finalWinners.add(winnerTeam);
              finalLosers.add(loserTeam);
              dynamicPodium[0] = winnerTeam;
              dynamicPodium[1] = loserTeam;
            } else if (m.group === '3º lugar') {
              thirdWinners.add(winnerTeam);
              thirdLosers.add(loserTeam);
              dynamicPodium[2] = winnerTeam;
              dynamicPodium[3] = loserTeam;
            }
          }
        }
      }
    });

    // ---------- RANKING ATUAL (com regras dinâmicas) ----------
    const currentRanking = bets
      .map(b => {
        const betUserId = b.user?._id?.toString();
        if (!betUserId) return null;

        const computed = computeBetTotal(b, matchMap, settings, isLive);

        return {
          userId: betUserId,
          points: computed.totalPoints,
          groupPhasePoints: computed.groupPhasePoints,
          knockoutPoints: computed.knockoutPoints,
          podiumPoints: computed.podiumPoints,
          extrasPoints: computed.extrasPoints,
          bonusPoints: computed.bonusPoints,
          name: b.user?.name || ''
        };
      })
      .filter(Boolean);

    const sortedCurrentRanking = [...currentRanking].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    const targetPoints = sortedCurrentRanking.find(r => r.userId === activeUserId)?.points || 0;
    const leaderPoints = sortedCurrentRanking[0]?.points || 0;

    let currentPosition = 1;
    let lastPoints = null;
    let posToAssign = 0;
    const simulatedRankingList = [];

    sortedCurrentRanking.forEach((item, i) => {
      if (lastPoints === null || item.points !== lastPoints) {
        posToAssign = i + 1;
        lastPoints = item.points;
      }
      if (item.userId === activeUserId) currentPosition = posToAssign;

      simulatedRankingList.push({
        position: posToAssign,
        userId: item.userId,
        points: item.points,
        name: item.name
      });
    });

    const positionMap = new Map();
    simulatedRankingList.forEach(r => positionMap.set(r.userId, r.position));

    const displayFutureMatches = matches
      .filter(m => (isLive ? m.status === 'scheduled' : m.status !== 'finished') || m.isSimulated)
      .sort(sortMatchesChronologically);
    const mathFutureMatches = displayFutureMatches.filter(m => !m.isSimulated);

    // ---------- GHOST POINTS (mata-mata faltante no DB) ----------
    const ghostPhasesOrder = ['16-avos de final', 'Oitavas de final', 'Quartas de final', 'Semifinal', '3º lugar', 'Final'];
    let startedKnockoutAt = null;

    for (const phase of ghostPhasesOrder) {
      if (matches.some(m => (m.phase === 'knockout' || m.phase === 'mata-mata') && m.group === phase)) {
        startedKnockoutAt = phase;
        break;
      }
    }

    let ghostPoints = 0;
    if (startedKnockoutAt) {
      const startIndex = ghostPhasesOrder.indexOf(startedKnockoutAt);
      for (let i = startIndex; i < ghostPhasesOrder.length; i++) {
        const phaseName = ghostPhasesOrder[i];
        const expectedMatches = knockoutQuotas[phaseName];
        const actualMatchesInDb = matches.filter(m => (m.phase === 'knockout' || m.phase === 'mata-mata') && m.group === phaseName).length;
        const missingMatches = Math.max(0, expectedMatches - actualMatchesInDb);
        ghostPoints += missingMatches * maxPointsPerMatch;
      }
    }

    // ---------- HELPERS DE RANKING SIMULADO ----------
    const getRankingSnapshot = (pointsMap) => {
      const list = Object.entries(pointsMap)
        .map(([userId, points]) => {
          const bet = betsByUserMap.get(userId);
          return { userId, points, name: bet?.user?.name || '' };
        })
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

      let posToAssign = 0;
      let lastPts = null;

      const ranked = list.map((item, index) => {
        if (lastPts === null || item.points !== lastPts) {
          posToAssign = index + 1;
          lastPts = item.points;
        }
        return { ...item, position: posToAssign };
      });

      const target = ranked.find(r => r.userId === activeUserId);
      const leader = ranked[0] || null;

      return {
        ranked,
        targetPosition: target?.position || ranked.length + 1,
        targetPoints: target?.points || 0,
        leaderId: leader?.userId || null,
        leaderPoints: leader?.points || 0,
        gapToLeader: (leader?.points || 0) - (target?.points || 0)
      };
    };

    // ---------- SIMULAÇÃO STEP-BY-STEP ----------
    const stepByStepSimulations = {};
    let miracleAchieved = false;
    let miracleCriticalMatches = 0;

    if ((isMiracleMode || mode === 'simulacao') && activeUserId) {
      const placarDinamico = {};
      let jogosParaCalculo = [];

      if (isMiracleMode) {
        currentRanking.forEach(u => { placarDinamico[u.userId] = u.points; });
        jogosParaCalculo = [...mathFutureMatches].sort(sortMatchesChronologically);
      } else {
        const basePointsMap = {};
        bets.forEach(b => {
          const betUserId = b.user?._id?.toString();
          if (!betUserId) return;
          const computed = computeBetTotal(b, matchMap, settings, isLive);
          basePointsMap[betUserId] = computed.totalPoints;
        });
        Object.assign(placarDinamico, basePointsMap);
        jogosParaCalculo = matches.filter(m => m.isSimulated).sort(sortMatchesChronologically);
      }

      const isNoTopo = () => getRankingSnapshot(placarDinamico).targetPosition === 1;

      for (const m of jogosParaCalculo) {
        if (isMiracleMode && isNoTopo()) break;

        const midStr = String(m.matchId);
        const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
        let winChoice, qualChoice;
        let simScoreA = null, simScoreB = null;

        if (isMiracleMode) {
          const targetPick = targetPicksMap.get(midStr);
          if (!targetPick || (!targetPick.winner && !targetPick.qualifier)) continue;
          winChoice = targetPick.winner;
          qualChoice = targetPick.qualifier;
          simScoreA = targetPick.scoreA;
          simScoreB = targetPick.scoreB;
        } else {
          const simData = parsedSimulations[midStr];
          if (!simData) continue;

          winChoice = simData.winner?.toLowerCase();
          if (winChoice === 'a') winChoice = 'A';
          else if (winChoice === 'b') winChoice = 'B';
          else if (winChoice === 'draw') winChoice = 'draw';
          else winChoice = null;

          qualChoice = simData.qualifier?.toUpperCase();
          if (qualChoice !== 'A' && qualChoice !== 'B') qualChoice = null;
          simScoreA = simData.scoreA;
          simScoreB = simData.scoreB;
        }

        if (!winChoice && !qualChoice) continue;

        const isFinal = m.group === 'Final';
        const isThirdPlace = m.group === '3º lugar';
        let simWinnerTeam = null;
        let simLoserTeam = null;

        if (isFinal || isThirdPlace) {
          const side = qualChoice || winChoice;
          if (side === 'A') { simWinnerTeam = m.teamA; simLoserTeam = m.teamB; }
          else if (side === 'B') { simWinnerTeam = m.teamB; simLoserTeam = m.teamA; }
        }

        const before = getRankingSnapshot(placarDinamico);

        stepByStepSimulations[midStr] = {
          winner: winChoice || null,
          qualifier: isKnockoutPhase ? (qualChoice || null) : null,
          isCritical: false
        };

        Array.from(betsByUserMap.values()).forEach(bet => {
          const rivalPick = (bet.groupMatches || []).find(gm => String(gm.matchId) === midStr);
          const uId = bet.user._id.toString();

          if (rivalPick) {
            // Simula match com o resultado escolhido
            const simulatedMatch = {
              ...m,
              status: 'finished',
              isSimulated: true,
              scoreA: simScoreA ?? (winChoice === 'A' ? 2 : winChoice === 'B' ? 0 : 1),
              scoreB: simScoreB ?? (winChoice === 'B' ? 2 : winChoice === 'A' ? 0 : 1),
              regularTimeScoreA: simScoreA ?? (winChoice === 'A' ? 2 : winChoice === 'B' ? 0 : 1),
              regularTimeScoreB: simScoreB ?? (winChoice === 'B' ? 2 : winChoice === 'A' ? 0 : 1),
              qualifiedSide: qualChoice || (winChoice !== 'draw' ? winChoice : null)
            };

            const { points } = calcMatchPoints(rivalPick, simulatedMatch, scoringRules, champRules);
            placarDinamico[uId] = (placarDinamico[uId] || 0) + points;
          }

          // Pódio dinâmico
          if (simWinnerTeam && simLoserTeam && bet.podium && bet.podium.length > 0) {
            if (isFinal) {
              if (!officialPodium[0] && strMatch(bet.podium[0], simWinnerTeam)) {
                placarDinamico[uId] = (placarDinamico[uId] || 0) + (podiumPointsArr[0] || 0);
              }
              if (!officialPodium[1] && strMatch(bet.podium[1], simLoserTeam)) {
                placarDinamico[uId] = (placarDinamico[uId] || 0) + (podiumPointsArr[1] || 0);
              }
            } else if (isThirdPlace) {
              if (!officialPodium[2] && strMatch(bet.podium[2], simWinnerTeam)) {
                placarDinamico[uId] = (placarDinamico[uId] || 0) + (podiumPointsArr[2] || 0);
              }
              if (!officialPodium[3] && strMatch(bet.podium[3], simLoserTeam)) {
                placarDinamico[uId] = (placarDinamico[uId] || 0) + (podiumPointsArr[3] || 0);
              }
            }
          }
        });

        const after = getRankingSnapshot(placarDinamico);

        const changedLeader = before.leaderId !== after.leaderId;
        const improvedPos = after.targetPosition < before.targetPosition;
        const worsenedPos = after.targetPosition > before.targetPosition;
        const reducedGap = after.gapToLeader < before.gapToLeader;
        const increasedGap = after.gapToLeader > before.gapToLeader;

        const isImpactful = isMiracleMode
          ? (changedLeader || improvedPos || reducedGap)
          : (changedLeader || improvedPos || worsenedPos || reducedGap || increasedGap);

        if (isImpactful) {
          if (isMiracleMode) miracleCriticalMatches++;
          stepByStepSimulations[midStr].isCritical = true;
        }

        let impactType = 'neutral';
        if (improvedPos || reducedGap || (changedLeader && after.targetPosition === 1)) {
          impactType = 'positive';
        } else if (worsenedPos || increasedGap) {
          impactType = 'negative';
        }

        stepByStepSimulations[midStr].impact = {
          posBefore: before.targetPosition,
          posAfter: after.targetPosition,
          gapBefore: before.gapToLeader,
          gapAfter: after.gapToLeader,
          type: impactType
        };
      }

      if (isMiracleMode) miracleAchieved = isNoTopo();
    }

    // ---------- POTENCIAL DE PÓDIO E ELIMINAÇÕES POR USUÁRIO ----------
    const userPodiumPotentialMap = new Map();
    const userSpecificEliminatedMap = new Map();
    const userConflictingMatchIds = new Map();

    bets.forEach(b => {
      const betUserId = b.user?._id?.toString();
      if (!betUserId) return;

      let pot = 0;
      const userEliminatedTeams = new Set(eliminatedTeams);

      if (b.podium && b.podium.length > 0) {
        // Força matemática: eliminações diretas quando 2 times do pódio se enfrentam precocemente
        mathFutureMatches.forEach(m => {
          const isEarlyKnockout = (m.phase === 'knockout' || m.phase === 'mata-mata') &&
            !['Semifinal', 'Final', '3º lugar'].includes(m.group);

          if (isEarlyKnockout && m.teamA && m.teamB) {
            const idxA = b.podium.findIndex(t => strMatch(t, m.teamA));
            const idxB = b.podium.findIndex(t => strMatch(t, m.teamB));

            if (idxA !== -1 && idxB !== -1) {
              let maxWeightA = 0;
              if (!dynamicPodium[idxA]) maxWeightA = Math.max(maxWeightA, podiumPointsArr[idxA] || 0);

              let maxWeightB = 0;
              if (!dynamicPodium[idxB]) maxWeightB = Math.max(maxWeightB, podiumPointsArr[idxB] || 0);

              if (maxWeightA >= maxWeightB) {
                userEliminatedTeams.add(m.teamB);
              } else {
                userEliminatedTeams.add(m.teamA);
              }
            }
          }
        });

        // Cálculo de potencial
        const teamMaxPotential = {};
        for (let i = 0; i < podiumSize; i++) {
          const teamName = b.podium[i];
          if (!teamName || dynamicPodium[i] || userEliminatedTeams.has(teamName)) continue;

          let isPositionValid = true;
          if (semiWinners.has(teamName) && (i === 2 || i === 3)) isPositionValid = false;
          if (semiLosers.has(teamName) && (i === 0 || i === 1)) isPositionValid = false;
          if (finalWinners.has(teamName) && i !== 0) isPositionValid = false;
          if (finalLosers.has(teamName) && i !== 1) isPositionValid = false;
          if (thirdWinners.has(teamName) && i !== 2) isPositionValid = false;
          if (thirdLosers.has(teamName) && i !== 3) isPositionValid = false;

          if (isPositionValid) {
            const weight = podiumPointsArr[i] || 0;
            if (!teamMaxPotential[teamName] || weight > teamMaxPotential[teamName]) {
              teamMaxPotential[teamName] = weight;
            }
          }
        }

        pot = Object.values(teamMaxPotential).reduce((acc, val) => acc + val, 0);

        // Identificação de contradições
        const conflictingMatches = new Set();
        const validPodiumTeams = new Set(Object.keys(teamMaxPotential));

        mathFutureMatches.forEach(m => {
          const gm = (b.groupMatches || []).find(g => String(g.matchId) === String(m.matchId));
          if (!gm) return;

          const isEarlyKnockout = (m.phase === 'knockout' || m.phase === 'mata-mata') &&
            !['Semifinal', 'Final', '3º lugar'].includes(m.group);

          if (isEarlyKnockout && m.teamA && m.teamB) {
            let predictedLoser = null;
            if (gm.qualifier === 'B') predictedLoser = m.teamA;
            else if (gm.qualifier === 'A') predictedLoser = m.teamB;
            else if (gm.winner === 'B') predictedLoser = m.teamA;
            else if (gm.winner === 'A') predictedLoser = m.teamB;

            if (predictedLoser && validPodiumTeams.has(predictedLoser)) {
              conflictingMatches.add(String(m.matchId));
            }
          }
        });

        userConflictingMatchIds.set(betUserId, conflictingMatches);
      } else {
        userConflictingMatchIds.set(betUserId, new Set());
      }

      userPodiumPotentialMap.set(betUserId, pot);
      userSpecificEliminatedMap.set(betUserId, userEliminatedTeams);
    });

    const targetPodiumPotential = userPodiumPotentialMap.get(activeUserId) || 0;
    const targetEliminatedTeams = userSpecificEliminatedMap.get(activeUserId) || eliminatedTeams;
    const targetConflicting = userConflictingMatchIds.get(activeUserId) || new Set();

    const isPodiumLocked = !unlockedPhases.includes('podium') && !unlockedPhases.includes('Pódio');
    const hidePodium = !isViewingSelf && isPodiumLocked;
    const podiumDetails = [];

    if (targetBet.podium && targetBet.podium.length > 0) {
      for (let i = 0; i < podiumSize; i++) {
        if (hidePodium) {
          podiumDetails.push({ team: 'Conteúdo Bloqueado 🔒', position: i + 1, points: podiumPointsArr[i] || 0, status: 'locked' });
          continue;
        }
        const teamName = targetBet.podium[i];
        if (teamName) {
          let isInvalidDynamic = false;
          if (semiWinners.has(teamName) && (i === 2 || i === 3)) isInvalidDynamic = true;
          if (semiLosers.has(teamName) && (i === 0 || i === 1)) isInvalidDynamic = true;
          if (finalWinners.has(teamName) && i !== 0) isInvalidDynamic = true;
          if (finalLosers.has(teamName) && i !== 1) isInvalidDynamic = true;
          if (thirdWinners.has(teamName) && i !== 2) isInvalidDynamic = true;
          if (thirdLosers.has(teamName) && i !== 3) isInvalidDynamic = true;

          let status = 'alive';
          if (strMatch(dynamicPodium[i], teamName)) {
            status = 'conquered';
          } else if (dynamicPodium[i] || targetEliminatedTeams.has(teamName) || isInvalidDynamic) {
            status = 'dead';
          }

          const matchRef = matches.find(m => m.teamA === teamName || m.teamB === teamName);
          const logoUrl = matchRef ? (matchRef.teamA === teamName ? matchRef.logoA : matchRef.logoB) : null;
          podiumDetails.push({ team: teamName, logoUrl, position: i + 1, points: podiumPointsArr[i] || 0, status });
        }
      }
    }

    // ---------- PROJEÇÃO DO TARGET ("UNIVERSO PERFEITO") ----------
    const projectedRanking = currentRanking.map(r => {
      let projPts = r.points;
      const isTarget = r.userId === activeUserId;
      const bRef = betsByUserMap.get(r.userId);

      mathFutureMatches.forEach(m => {
        const midStr = String(m.matchId);
        const targetPick = targetPicksMap.get(midStr);
        const rivalPick = (bRef?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
        const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';

        if (isTarget) {
          if (!targetConflicting.has(midStr) && targetPick) {
            const simulatedMatch = {
              ...m,
              status: 'finished',
              isSimulated: true,
              scoreA: targetPick.scoreA,
              scoreB: targetPick.scoreB,
              regularTimeScoreA: targetPick.scoreA,
              regularTimeScoreB: targetPick.scoreB,
              qualifiedSide: targetPick.qualifier || (targetPick.winner !== 'draw' ? targetPick.winner : null)
            };
            const { points } = calcMatchPoints(targetPick, simulatedMatch, scoringRules, champRules);
            projPts += points;
          }
        } else if (targetPick && rivalPick) {
          if (targetConflicting.has(midStr)) {
            // Universo perfeito: resultado é o inverso do palpite do target
            const invertedWinner = targetPick.winner === 'A' ? 'B' : targetPick.winner === 'B' ? 'A' : targetPick.winner;
            const invertedQual = targetPick.qualifier === 'A' ? 'B' : targetPick.qualifier === 'B' ? 'A' : targetPick.qualifier;
            const simulatedMatch = {
              ...m,
              status: 'finished',
              isSimulated: true,
              scoreA: targetPick.scoreA,
              scoreB: targetPick.scoreB,
              regularTimeScoreA: targetPick.scoreA,
              regularTimeScoreB: targetPick.scoreB,
              qualifiedSide: invertedQual || (invertedWinner !== 'draw' ? invertedWinner : null)
            };
            const rivalSimulatedPick = { ...rivalPick, winner: invertedWinner, qualifier: invertedQual };
            const { points } = calcMatchPoints(rivalSimulatedPick, simulatedMatch, scoringRules, champRules);
            projPts += points;
          } else {
            const simulatedMatch = {
              ...m,
              status: 'finished',
              isSimulated: true,
              scoreA: targetPick.scoreA,
              scoreB: targetPick.scoreB,
              regularTimeScoreA: targetPick.scoreA,
              regularTimeScoreB: targetPick.scoreB,
              qualifiedSide: targetPick.qualifier || (targetPick.winner !== 'draw' ? targetPick.winner : null)
            };
            const { points } = calcMatchPoints(rivalPick, simulatedMatch, scoringRules, champRules);
            projPts += points;
          }
        }
      });

      if (isTarget) {
        projPts += targetPodiumPotential + ghostPoints;
      } else {
        let rivalPodiumInTargetUniverse = 0;
        const rivalEliminated = userSpecificEliminatedMap.get(r.userId) || eliminatedTeams;

        if (targetBet.podium && targetBet.podium.length > 0) {
          const targetLockedPositions = {};
          const targetUsedTeams = new Set();

          for (let i = 0; i < podiumSize; i++) {
            if (dynamicPodium[i]) continue;
            const targetTeam = targetBet.podium[i];
            if (targetTeam && !targetEliminatedTeams.has(targetTeam)) {
              let invalid = false;
              if (semiWinners.has(targetTeam) && (i === 2 || i === 3)) invalid = true;
              if (semiLosers.has(targetTeam) && (i === 0 || i === 1)) invalid = true;
              if (finalWinners.has(targetTeam) && i !== 0) invalid = true;
              if (finalLosers.has(targetTeam) && i !== 1) invalid = true;
              if (thirdWinners.has(targetTeam) && i !== 2) invalid = true;
              if (thirdLosers.has(targetTeam) && i !== 3) invalid = true;

              if (!invalid) {
                targetLockedPositions[i] = targetTeam;
                targetUsedTeams.add(targetTeam);
              }
            }
          }

          for (let i = 0; i < podiumSize; i++) {
            if (dynamicPodium[i]) continue;
            const rivalTeam = bRef?.podium?.[i];
            if (!rivalTeam) continue;

            if (targetLockedPositions[i]) {
              if (strMatch(rivalTeam, targetLockedPositions[i])) {
                rivalPodiumInTargetUniverse += podiumPointsArr[i] || 0;
              }
            } else {
              if (!rivalEliminated.has(rivalTeam) && !targetUsedTeams.has(rivalTeam)) {
                let invalidRival = false;
                if (semiWinners.has(rivalTeam) && (i === 2 || i === 3)) invalidRival = true;
                if (semiLosers.has(rivalTeam) && (i === 0 || i === 1)) invalidRival = true;
                if (finalWinners.has(rivalTeam) && i !== 0) invalidRival = true;
                if (finalLosers.has(rivalTeam) && i !== 1) invalidRival = true;
                if (thirdWinners.has(rivalTeam) && i !== 2) invalidRival = true;
                if (thirdLosers.has(rivalTeam) && i !== 3) invalidRival = true;

                if (!invalidRival) {
                  rivalPodiumInTargetUniverse += podiumPointsArr[i] || 0;
                  targetUsedTeams.add(rivalTeam);
                }
              }
            }
          }
        } else {
          rivalPodiumInTargetUniverse = userPodiumPotentialMap.get(r.userId) || 0;
        }

        projPts += rivalPodiumInTargetUniverse;
      }

      return { userId: r.userId, totalPoints: projPts, name: r.name };
    });

    projectedRanking.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    const targetUserProj = projectedRanking.find(r => r.userId === activeUserId);
    const usersBetter = projectedRanking.filter(r => r.totalPoints > (targetUserProj?.totalPoints ?? 0)).length;
    const targetMaxPosition = usersBetter + 1;

    // ---------- CENÁRIO PESSIMISTA ----------
    const worstCaseTargetPoints = targetPoints;
    let usersBeatingTargetInWorstCase = 0;
    let maxRivalPotential = 0;

    currentRanking.forEach(r => {
      if (r.userId !== activeUserId) {
        const bRef = betsByUserMap.get(r.userId);
        let rivalMaxPts = r.points;
        const rivalConflicting = userConflictingMatchIds.get(r.userId) || new Set();

        mathFutureMatches.forEach(m => {
          const midStr = String(m.matchId);
          const rivalPick = (bRef?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
          if (!rivalPick) return;

          if (!rivalConflicting.has(midStr)) {
            const simulatedMatch = {
              ...m,
              status: 'finished',
              isSimulated: true,
              scoreA: rivalPick.scoreA,
              scoreB: rivalPick.scoreB,
              regularTimeScoreA: rivalPick.scoreA,
              regularTimeScoreB: rivalPick.scoreB,
              qualifiedSide: rivalPick.qualifier || (rivalPick.winner !== 'draw' ? rivalPick.winner : null)
            };
            const { points } = calcMatchPoints(rivalPick, simulatedMatch, scoringRules, champRules);
            rivalMaxPts += points;
          }
        });

        const rivalPodium = userPodiumPotentialMap.get(r.userId) || 0;
        rivalMaxPts += rivalPodium + ghostPoints;

        if (rivalMaxPts > maxRivalPotential) maxRivalPotential = rivalMaxPts;
        if (rivalMaxPts > worstCaseTargetPoints) usersBeatingTargetInWorstCase++;
      }
    });

    const targetMinPosition = usersBeatingTargetInWorstCase + 1;

    let statusBadge = 'IN_CONTENTION';
    if (targetMinPosition <= 2) {
      statusBadge = 'GUARANTEED_PODIUM';
    } else if (targetMaxPosition > 2) {
      statusBadge = 'ELIMINATED';
    }

    // ---------- PONTOS EM DISPUTA ----------
    const matchPointsLeft = mathFutureMatches.reduce((acc, m) => {
      const midStr = String(m.matchId);
      if (targetConflicting.has(midStr)) return acc;

      const targetPick = targetPicksMap.get(midStr);
      if (!targetPick) return acc;

      const simulatedMatch = {
        ...m,
        status: 'finished',
        isSimulated: true,
        scoreA: targetPick.scoreA,
        scoreB: targetPick.scoreB,
        regularTimeScoreA: targetPick.scoreA,
        regularTimeScoreB: targetPick.scoreB,
        qualifiedSide: targetPick.qualifier || (targetPick.winner !== 'draw' ? targetPick.winner : null)
      };
      const { points } = calcMatchPoints(targetPick, simulatedMatch, scoringRules, champRules);
      return acc + points;
    }, 0);

    const totalPotential = matchPointsLeft + targetPodiumPotential + ghostPoints;
    const targetMaxTotal = targetPoints + totalPotential;

    // ---------- PROBABILIDADE ----------
    let probability = 0;
    if (targetMaxPosition === 1) {
      if (targetPoints >= maxRivalPotential) {
        probability = 100;
      } else if (targetPoints > leaderPoints) {
        const margem = targetPoints - leaderPoints;
        probability = Math.min(99, 80 + (margem * 2));
      } else {
        const leaders = sortedCurrentRanking.filter(r => r.points === leaderPoints && r.userId !== activeUserId);
        if (leaders.length === 0) {
          const ameaca = maxRivalPotential - targetPoints;
          if (ameaca <= 0) {
            probability = 100;
          } else {
            const pontosEmDisputa = totalPotential > 0 ? totalPotential : 1;
            const fatorSeguranca = Math.max(0, 1 - (ameaca / pontosEmDisputa));
            probability = Math.round(80 + (19 * fatorSeguranca));
          }
        } else {
          let minChanceAgainstLeaders = 100;
          leaders.forEach(leader => {
            const leaderBet = betsByUserMap.get(leader.userId);
            let contestedPoints = 0;

            mathFutureMatches.forEach(m => {
              const midStr = String(m.matchId);
              const isKnockout = m.phase === 'knockout' || m.phase === 'mata-mata';
              const targetPick = targetPicksMap.get(midStr);
              const leaderPick = (leaderBet?.groupMatches || []).find(gm => String(gm.matchId) === midStr);

              if (targetPick && leaderPick) {
                if (targetPick.winner !== leaderPick.winner) contestedPoints += (scoringRules.winner || 0);
                if (isKnockout && targetPick.qualifier !== leaderPick.qualifier) contestedPoints += (scoringRules.qualifier || 0);
                if (targetPick.scoreA !== leaderPick.scoreA || targetPick.scoreB !== leaderPick.scoreB) {
                  contestedPoints += (scoringRules.exactScore || 0) + (scoringRules.scoreTeamA || 0) + (scoringRules.scoreTeamB || 0);
                }
              }
            });

            if (targetBet.podium && targetBet.podium.length > 0) {
              const targetPodiumTeamsMaxContested = {};
              for (let i = 0; i < podiumSize; i++) {
                if (dynamicPodium[i]) continue;
                const myTeam = targetBet.podium[i];
                const leaderTeam = leaderBet?.podium?.[i];
                if (myTeam && !targetEliminatedTeams.has(myTeam) && !strMatch(myTeam, leaderTeam)) {
                  const weight = podiumPointsArr[i] || 0;
                  if (!targetPodiumTeamsMaxContested[myTeam] || weight > targetPodiumTeamsMaxContested[myTeam]) {
                    targetPodiumTeamsMaxContested[myTeam] = weight;
                  }
                }
              }
              contestedPoints += Object.values(targetPodiumTeamsMaxContested).reduce((acc, val) => acc + val, 0);
            }

            contestedPoints += ghostPoints;

            const gap = leader.points - targetPoints;
            if (contestedPoints >= gap) {
              if (contestedPoints === 0 && gap === 0) {
                minChanceAgainstLeaders = Math.min(minChanceAgainstLeaders, 50);
              } else {
                const margin = contestedPoints - gap;
                const reachabilityChance = 5 + ((margin / contestedPoints) * 70);
                minChanceAgainstLeaders = Math.min(minChanceAgainstLeaders, reachabilityChance);
              }
            } else {
              minChanceAgainstLeaders = 0;
            }
          });

          probability = Math.max(0, Math.round(minChanceAgainstLeaders));
        }
      }
    }

    // ---------- MONTAGEM DA ANÁLISE POR PARTIDA ----------
    const matchesAnalysis = displayFutureMatches.map((m, index) => {
      const midStr = String(m.matchId);
      const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
      const isLocked = (m.phase === 'group' ? !unlockedPhases.includes('group') : !unlockedPhases.includes(m.group));
      const targetPick = targetPicksMap.get(midStr);

      let MARGEM_DE_PERIGO_PARTIDAS = 3;
      if (m.phase === 'group') {
        MARGEM_DE_PERIGO_PARTIDAS = 2;
      } else if (isKnockoutPhase) {
        switch (m.group) {
          case '16-avos de final': MARGEM_DE_PERIGO_PARTIDAS = 4; break;
          case 'Oitavas de final': MARGEM_DE_PERIGO_PARTIDAS = 3; break;
          case 'Quartas de final': MARGEM_DE_PERIGO_PARTIDAS = 3; break;
          case 'Semifinal':
          case '3º lugar':
          case 'Final': MARGEM_DE_PERIGO_PARTIDAS = 2; break;
        }
      }

      const meuPotencialMaximo = targetPoints + targetPodiumPotential + ghostPoints;
      const MARGEM_DE_PERIGO_PONTOS = MARGEM_DE_PERIGO_PARTIDAS * maxPointsPerMatch;

      const rivalsToWatch = currentRanking.filter(r => {
        if (r.userId === activeUserId) return false;
        if (r.points > targetPoints) return true;

        const rivalPodium = userPodiumPotentialMap.get(r.userId) || 0;
        const rivalPotencialMaximo = r.points + rivalPodium + ghostPoints;

        return rivalPotencialMaximo >= (meuPotencialMaximo - MARGEM_DE_PERIGO_PONTOS);
      });

      const opponentsToWatch = isLocked ? [{ name: "Conteúdo Bloqueado 🔒", color: 'locked' }] : rivalsToWatch.filter(ra => {
        const rb = betsByUserMap.get(ra.userId);
        const rp = (rb?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
        return rp && (rp.winner !== targetPick?.winner || (isKnockoutPhase && rp.qualifier !== targetPick?.qualifier));
      }).map(ra => {
        const rivalName = betsByUserMap.get(ra.userId)?.user?.name;
        if (!rivalName) return null;

        const rivalPosition = positionMap.get(ra.userId) || 999;
        let colorCode = 'red';

        if (rivalPosition === 1) {
          colorCode = 'gold';
        } else if (rivalPosition <= currentPosition) {
          colorCode = 'green';
        } else {
          colorCode = 'red';
        }

        return { name: rivalName, color: colorCode };
      }).filter(Boolean);

      // Índice de Ousadia (Fator Kamikaze)
      let matchOusadia = null;
      if (!isLocked && targetPick && (targetPick.winner || (isKnockoutPhase && targetPick.qualifier))) {
        let divergencias = 0;
        let totalComparavel = 0;

        betsByUserMap.forEach((betData, uId) => {
          if (uId !== activeUserId) {
            const rivalPick = (betData.groupMatches || []).find(gm => String(gm.matchId) === midStr);
            if (rivalPick && (rivalPick.winner || (isKnockoutPhase && rivalPick.qualifier))) {
              totalComparavel++;
              let isDifferent = false;

              if (targetPick.winner !== rivalPick.winner) isDifferent = true;
              if (isKnockoutPhase && targetPick.qualifier !== rivalPick.qualifier) isDifferent = true;

              if (isDifferent) divergencias++;
            }
          }
        });

        if (totalComparavel > 0) {
          const ousadiaPercentage = Math.round((divergencias / totalComparavel) * 100);
          let ousadiaLevel = 'Seguro';

          if (ousadiaPercentage >= 67) {
            ousadiaLevel = 'Kamikaze';
          } else if (ousadiaPercentage >= 34) {
            ousadiaLevel = 'Equilibrado';
          }

          matchOusadia = {
            level: ousadiaLevel,
            percentage: ousadiaPercentage,
            divergencias,
            totalComparavel
          };
        }
      }

      const hideTargetPick = isLocked && !isViewingSelf;

      const miracleData = stepByStepSimulations[midStr] || null;
      const isMiracleResult = !!miracleData;
      const miracleChoice = miracleData ? miracleData.winner : null;
      const miracleQualifier = miracleData ? miracleData.qualifier : null;
      const miracleImpact = miracleData ? miracleData.impact : null;

      const isSimulationMode = mode === 'simulacao' || isMiracleMode;
      const hasImpact = isSimulationMode ? true : (m.isSimulated === true || isMiracleResult === true || opponentsToWatch.length > 0);

      return {
        matchId: m.matchId,
        date: m.date,
        time: m.time,
        teams: `${m.teamA} x ${m.teamB}`,
        status: m.status,
        phase: m.phase,
        group: m.group,
        hasImpact,
        isMiracleResult,
        isCriticalForMiracle: miracleData ? !!miracleData.isCritical : false,
        miracleImpact,
        miracleChoice,
        miracleQualifier,
        isLocked,
        ousadia: matchOusadia,
        myChoice: hideTargetPick ? {
          winner: null,
          scoreA: null,
          scoreB: null,
          label: 'Conteúdo Bloqueado 🔒',
          qualifier: null,
          qualifierName: 'Conteúdo Bloqueado 🔒'
        } : {
          winner: targetPick?.winner || null,
          scoreA: targetPick?.scoreA ?? null,
          scoreB: targetPick?.scoreB ?? null,
          label: targetPick?.winner === 'A' ? m.teamA : (targetPick?.winner === 'B' ? m.teamB : (targetPick?.winner === 'draw' ? 'Empate' : 'Sem Palpite')),
          qualifier: targetPick?.qualifier || null,
          qualifierName: targetPick?.qualifier === 'A' ? m.teamA : (targetPick?.qualifier === 'B' ? m.teamB : (isKnockoutPhase ? 'Sem Palpite' : null))
        },
        opponentsToWatch
      };
    });

    const miracleTotalMatchesNeeded = Object.keys(stepByStepSimulations).length;

    res.json({
      success: true,
      data: {
        summary: {
          currentPosition,
          maxPosition: targetMaxPosition,
          minPosition: targetMinPosition,
          statusBadge,
          probability,
          currentPoints: targetPoints,
          maxPoints: targetMaxTotal,
          podiumPotential: targetPodiumPotential,
          totalMatches: displayFutureMatches.length,
          podiumDetails,
          miracleAchieved,
          miracleTotalMatchesNeeded,
          miracleCriticalMatches,
          simulatedRanking: simulatedRankingList,
          nemesis: null
        },
        matches: matchesAnalysis
      }
    });
  } catch (e) {
    console.error('❌ ERRO CRÍTICO NO CAMINHO DA LIDERANÇA:', e);
    res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

/* ================================================================
   🎯 GET /my-bets (Filtrado por Liga)
   ================================================================ */

router.get('/my-bets', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é obrigatório' });
    }

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);

    const [bet, matches, settings] = await Promise.all([
      Bet.findOne({ user: req.user._id, leagueId: lIdStr }).lean(),
      Match.find({ leagueId: toLeagueId(leagueId) }).lean(),
      Settings.findById(toLeagueId(leagueId)).lean()
    ]);

    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
    }

    const matchIdsDaLiga = new Set(matches.map(m => Number(m.matchId)));

    const gm = (bet.groupMatches || [])
      .filter(b => matchIdsDaLiga.has(Number(b.matchId)))
      .map((b) => {
        const m = matches.find(x => Number(x.matchId) === Number(b.matchId));
        const teamA = m?.teamA || 'Time A';
        const teamB = m?.teamB || 'Time B';
        return {
          ...b,
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${b.matchId}`,
          teamA,
          teamB,
          status: m?.status || 'scheduled',
          choiceLabel: toWinnerLabel(b.winner, teamA, teamB)
        };
      });

    const podiumSize = settings?.championshipRules?.podiumSize ?? 4;

    return res.json({
      success: true,
      data: {
        ...bet,
        groupMatches: gm,
        podium: bet.podium || [],
        extras: bet.extras || {},
        podiumSize
      },
      hasSubmitted: gm.length > 0
    });

  } catch (e) {
    console.error('GET /my-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
});

/* ================================================================
   💾 POST /save (Salvar todos os palpites)
   ================================================================ */

router.post('/save', protect, checkPaid, async (req, res) => {
  try {
    const { groupMatches, podium, extras, leagueId } = req.body;

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    }

    const configId = toLeagueId(leagueId);

    const [settings, dbMatches] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: toLeagueId(leagueId) }).select('matchId group phaseName teamA teamB date time status').lean()
    ]);

    // 🛡️ Verificação de bloqueio global de apostas
    if (settings?.blockSaveBets) {
      return res.status(403).json({
        success: false,
        message: 'O administrador bloqueou novas apostas nesta liga.'
      });
    }

    // Validação do pódio
    if (podium && Array.isArray(podium)) {
      const podiumSize = settings?.championshipRules?.podiumSize ?? 4;
      const validation = Bet.validatePodiumSize(podium, podiumSize);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }
    }

    const validMatchIds = new Set(dbMatches.map(m => m.matchId));
    const matchMap = new Map(dbMatches.map(m => [m.matchId, m]));

    // ============================================================
    // 🛡️ VALIDAÇÃO DE GRADE TRANCADA
    // ============================================================
    const matchIdsEnviados = Object.keys(groupMatches || {}).map(Number);

    if (settings && settings.lockedPhases && settings.lockedPhases.length > 0) {
      const existing = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) }).lean();
      const palpitesAntigosMap = new Map();
      if (existing && Array.isArray(existing.groupMatches)) {
        existing.groupMatches.forEach(b => palpitesAntigosMap.set(Number(b.matchId), b));
      }

      for (const matchId of matchIdsEnviados) {
        const idNum = Number(matchId);
        const matchData = matchMap.get(idNum);

        if (matchData) {
          const gradeDaPartida = matchData.phaseName || matchData.group;

          if (settings.lockedPhases.includes(gradeDaPartida)) {
            const palpiteEnviado = groupMatches[matchId] || groupMatches[String(matchId)];
            const classificadoEnviado = palpiteEnviado?.qualifier || null;

            const dadosAntigos = palpitesAntigosMap.get(idNum);
            const palpiteJaSalvo = dadosAntigos ? dadosAntigos.winner : null;
            const classificadoJaSalvo = dadosAntigos ? dadosAntigos.qualifier : null;

            const naoAlterouVencedor = palpiteEnviado?.winner === palpiteJaSalvo;
            const naoAlterouClassificado = String(classificadoEnviado || '') === String(classificadoJaSalvo || '');

            if (naoAlterouVencedor && naoAlterouClassificado) {
              continue;
            }

            return res.status(403).json({
              success: false,
              message: `As apostas para a grade "${gradeDaPartida}" já foram encerradas!`
            });
          }
        }
      }
    }

    // 🆕 CORREÇÃO CRÍTICA: Verifica se alguma partida enviada já começou
    const checkNow = new Date();
    for (const matchId of matchIdsEnviados) {
      const matchData = matchMap.get(Number(matchId));
      if (matchData && matchData.status !== 'scheduled') {
        return res.status(403).json({
          success: false,
          message: `Aposta bloqueada: Partida ${matchData.teamA} x ${matchData.teamB} já foi iniciada ou encerrada.`
        });
      }
      if (matchData) {
        const matchDate = parseMatchDate(matchData.date);
        if (matchDate && matchDate <= checkNow) {
          return res.status(403).json({
            success: false,
            message: `Aposta bloqueada: Partida ${matchData.teamA} x ${matchData.teamB} já começou.`
          });
        }
      }
    }

    // ============================================================
    // 3. Busca a aposta ESPECÍFICA desta liga
    // ============================================================
    let bet = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) });
    const gmMap = new Map();

    if (bet && Array.isArray(bet.groupMatches)) {
      bet.groupMatches.forEach((b) => gmMap.set(b.matchId, b));
    }

    // 4. Atualiza apenas palpites válidos
    Object.entries(groupMatches || {}).forEach(([matchId, data]) => {
      const idNum = Number(matchId);
      if (!validMatchIds.has(idNum)) return;

      const choice = data?.winner;
      const scoreA = data?.scoreA;
      const scoreB = data?.scoreB;

      if (!['A', 'B', 'draw'].includes(choice)) return;

      // 🆕 Se o admin zerou todas as regras de placar, aceita null/'' nos scores
      const scoringRules = settings?.scoringRules || {};
      const scoresDisabled =
        (scoringRules.exactScore || 0) === 0 &&
        (scoringRules.scoreTeamA || 0) === 0 &&
        (scoringRules.scoreTeamB || 0) === 0;

      if (!scoresDisabled && (scoreA == null || scoreB == null || scoreA === '' || scoreB === '')) return;

      let qualifier = data?.qualifier || null;
      if (qualifier !== 'A' && qualifier !== 'B') qualifier = null;

      const existingGm = gmMap.get(idNum);

      gmMap.set(idNum, {
        matchId: idNum,
        winner: choice,
        scoreA: Number(scoreA),
        scoreB: Number(scoreB),
        qualifier,
        points: existingGm?.points || 0,
        pointsBreakdown: existingGm?.pointsBreakdown || {
          exactScore: 0, scoreTeamA: 0, scoreTeamB: 0, winner: 0, qualifier: 0
        }
      });
    });

    const now = new Date();
    const listaFinalGrupoMatches = Array.from(gmMap.values());

    const payload = {
      user: req.user._id,
      leagueId: String(leagueId),
      groupMatches: listaFinalGrupoMatches,
      hasSubmitted: true,
      lastUpdate: now,
      firstSubmission: bet?.firstSubmission || now,
    };

    // 5. Trata o pódio (array)
    if (podium && Array.isArray(podium)) {
      payload.podium = podium.map(t => String(t).trim()).filter(t => t.length > 0);
    }

    // 6. Trata os extras
    if (extras && typeof extras === 'object') {
      payload.extras = {
        topScorer: extras.topScorer ? String(extras.topScorer).trim() : null,
        bestAttack: extras.bestAttack ? String(extras.bestAttack).trim() : null,
        worstDefense: extras.worstDefense ? String(extras.worstDefense).trim() : null,
        upset: extras.upset ? String(extras.upset).trim() : null
      };
    }

    // 7. Atualiza ou Cria a Aposta usando .save() para disparar o pre('save')
    if (!bet) {
      bet = new Bet(payload);
    } else {
      bet.set(payload);
    }

    await bet.save();

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { leagues: toLeagueId(leagueId) }
    });

    // ============================================================
    // 📧 E-MAIL DE COMPROVANTE
    // ============================================================
    try {
      const { sendBetsConfirmationEmail } = require('../services/emailService');
      const userEmail = req.user.email;
      const userName = req.user.name || 'Participante';
      const leagueName = settings?.title || `Liga #${leagueId}`;
      const protocolo = `${String(req.user._id).slice(-4).toUpperCase()}-${Date.now()}`;
      const dataEmissao = new Date().toLocaleString('pt-BR');

      const palpitesCompletos = [];
      listaFinalGrupoMatches.forEach((userBet) => {
        const matchInfo = dbMatches.find(m => Number(m.matchId) === Number(userBet.matchId));
        if (matchInfo && matchInfo.teamA && matchInfo.teamB) {
          palpitesCompletos.push({ ...userBet, gameData: matchInfo });
        }
      });

      const getPhaseWeight = (phaseName) => {
        const p = String(phaseName).toLowerCase();
        if (p.includes('3') || p.includes('terceiro')) return 60;
        if (p.includes('semi')) return 50;
        if (p.includes('quartas')) return 40;
        if (p.includes('oitavas')) return 30;
        if (p.includes('16') || p.includes('avos')) return 20;
        if (p.includes('final')) return 70;
        return 10;
      };

      palpitesCompletos.sort((a, b) => {
        const gradeA = a.gameData.phaseName || a.gameData.group || 'Geral';
        const gradeB = b.gameData.phaseName || b.gameData.group || 'Geral';
        const weightA = getPhaseWeight(gradeA);
        const weightB = getPhaseWeight(gradeB);
        if (weightA !== weightB) return weightB - weightA;
        return gradeA.localeCompare(gradeB, undefined, { numeric: true, sensitivity: 'base' });
      });

      let betsHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
          <div style="background-color: #2c3e50; padding: 15px; color: white; text-align: center; border-radius: 4px 4px 0 0;">
            <h2 style="margin: 0;">Comprovante de Palpites</h2>
            <p style="margin: 5px 0 0 0; font-size: 14px;">Protocolo: <strong>${protocolo}</strong></p>
            <p style="margin: 5px 0 0 0; font-size: 12px;">Emitido em: ${dataEmissao}</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; margin-top: 15px;">
            <thead>
              <tr style="background-color: #f4f6f7; border-bottom: 2px solid #bdc3c7;">
                <th style="padding: 12px; text-align: left; color: #34495e;">Confronto / Fase</th>
                <th style="padding: 12px; text-align: center; color: #34495e; width: 160px;">Seu Palpite</th>
              </tr>
            </thead>
            <tbody>
      `;

      let ultimaGrade = '';
      palpitesCompletos.forEach((item) => {
        const matchInfo = item.gameData;
        const gradeAtual = matchInfo.phaseName || matchInfo.group || 'Geral';

        if (gradeAtual !== ultimaGrade) {
          betsHtml += `
            <tr style="background-color: #eaeded;">
              <td colspan="2" style="padding: 8px 12px; font-weight: bold; color: #2c3e50; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                📂 ${gradeAtual}
              </td>
            </tr>
          `;
          ultimaGrade = gradeAtual;
        }

        let traducaoPalpite = '';
        if (item.winner === 'A') traducaoPalpite = `Vitória: ${matchInfo.teamA}`;
        if (item.winner === 'B') traducaoPalpite = `Vitória: ${matchInfo.teamB}`;
        if (item.winner === 'draw') traducaoPalpite = 'Empate';

        if (item.qualifier) {
          const timeClassificado = item.qualifier === 'A' ? matchInfo.teamA : matchInfo.teamB;
          traducaoPalpite += ` <br><span style="font-size: 11px; color: #e67e22; font-weight: normal;">(Classifica: ${timeClassificado})</span>`;
        }

        betsHtml += `
          <tr style="border-bottom: 1px solid #ecf0f1;">
            <td style="padding: 12px; color: #2c3e50;">
              <strong>${matchInfo.teamA}</strong> vs <strong>${matchInfo.teamB}</strong>
            </td>
            <td style="padding: 12px; text-align: center; font-weight: bold; color: #27ae60; background-color: #fafdfb;">
              ${traducaoPalpite}
            </td>
          </tr>
        `;
      });

      betsHtml += `</tbody></table>`;

      if (payload.podium && payload.podium.length > 0) {
        betsHtml += `
          <div style="margin-top: 25px; padding: 15px; background-color: #fcf8e3; border: 1px solid #faebcc; border-radius: 4px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #8a6d3b;">🏆 Seus Palpites de Pódio:</h4>
            ${payload.podium.map((team, idx) => `<p style="margin: 4px 0;"><strong>${idx + 1}º Lugar:</strong> ${team}</p>`).join('')}
          </div>
        `;
      }

      if (payload.extras) {
        betsHtml += `
          <div style="margin-top: 15px; padding: 15px; background-color: #e8f6f3; border: 1px solid #a3e4d7; border-radius: 4px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #1e8449;">🌟 Palpites Extras:</h4>
            ${payload.extras.topScorer ? `<p style="margin: 4px 0;"><strong>Artilheiro:</strong> ${payload.extras.topScorer}</p>` : ''}
            ${payload.extras.bestAttack ? `<p style="margin: 4px 0;"><strong>Melhor Ataque:</strong> ${payload.extras.bestAttack}</p>` : ''}
            ${payload.extras.worstDefense ? `<p style="margin: 4px 0;"><strong>Pior Defesa:</strong> ${payload.extras.worstDefense}</p>` : ''}
            ${payload.extras.upset ? `<p style="margin: 4px 0;"><strong>Zebra:</strong> ${payload.extras.upset}</p>` : ''}
          </div>
        `;
      }

      betsHtml += `
          <div style="margin-top: 30px; padding: 15px; border-top: 1px dashed #bdc3c7; font-size: 12px; color: #7f8c8d; background-color: #f9f9f9; border-radius: 0 0 4px 4px;">
            <p><strong>⚠️ AVISO IMPORTANTE DE AUDITORIA:</strong></p>
            <p>Este comprovante reflete exclusivamente os palpites salvos no sistema no exato momento de sua emissão (<strong>${dataEmissao}</strong>).</p>
            <p>Nossa plataforma permite a edição individual de palpites até o horário de início oficial de cada partida. <strong>Caso você realize qualquer alteração no site após o recebimento deste e-mail, este comprovante perderá automaticamente sua validade legal para as partidas alteradas.</strong> Em caso de divergência, prevalecerá incondicionalmente o último registro gravado em nosso banco de dados antes do bloqueio do jogo.</p>
          </div>
        </div>
      `;

      sendBetsConfirmationEmail(userEmail, userName, leagueName, betsHtml)
        .catch(err => console.error('❌ Falha assíncrona ao enviar e-mail de palpites:', err.message));

    } catch (emailSetupError) {
      console.error('❌ Erro na preparação do e-mail de palpites:', emailSetupError);
    }

    return res.json({
      success: true,
      message: 'Palpites salvos e participação confirmada!',
      data: { id: bet._id }
    });

  } catch (e) {
    console.error('POST /save error:', e);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpites' });
  }
});

/* ================================================================
   🎯 POST /single (Salvar palpite individual)
   ================================================================ */

router.post('/single', protect, checkPaid, async (req, res) => {
  try {
    const now = new Date();
    const { leagueId, matchId, winner, qualifier, scoreA, scoreB } = req.body;

    if (!leagueId || !matchId || !winner) {
      return res.status(400).json({ success: false, message: 'Dados insuficientes para salvar o palpite.' });
    }

    if (!['A', 'B', 'draw'].includes(winner)) {
      return res.status(400).json({ success: false, message: 'Palpite inválido. Escolha permitida: A, B ou draw.' });
    }

    // 🆕 CORREÇÃO CRÍTICA: Rejeita string vazia antes do cast para Number
    if (scoreA == null || scoreB == null || scoreA === '' || scoreB === '') {
      return res.status(400).json({ success: false, message: 'Placar (scoreA e scoreB) é obrigatório.' });
    }

    let validQualifier = null;
    if (qualifier === 'A' || qualifier === 'B') {
      validQualifier = qualifier;
    }

    const idNum = Number(matchId);

    const match = await Match.findOne({ matchId: idNum, leagueId: toLeagueId(leagueId) }).lean();

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada no sistema.' });
    }

    // ============================================================
    // 🛡️ SEGURANÇA 1: Trava de Horário Absoluta
    // ============================================================
    const matchDate = parseMatchDate(match.date);

    if (match.status !== 'scheduled' || (matchDate && matchDate <= now)) {
      return res.status(403).json({
        success: false,
        message: 'Aposta bloqueada: Esta partida já começou ou foi encerrada.'
      });
    }

    // ============================================================
    // 🛡️ SEGURANÇA 2: Trava de Fase/Grade
    // ============================================================
    const configId = toLeagueId(leagueId);
    const settings = await Settings.findById(configId).lean();

    // 🛡️ Verificação de bloqueio global de apostas
    if (settings?.blockSaveBets) {
      return res.status(403).json({
        success: false,
        message: 'O administrador bloqueou novas apostas nesta liga.'
      });
    }

    const gradeDaPartida = match.phaseName || match.group;

    if (settings && settings.lockedPhases && settings.lockedPhases.includes(gradeDaPartida)) {
      return res.status(403).json({
        success: false,
        message: `As apostas para a fase "${gradeDaPartida}" foram encerradas pelo Administrador!`
      });
    }

    // ============================================================
    // 💾 ATUALIZAÇÃO CIRÚRGICA
    // ============================================================
    let betDoc = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) });

    const novoPalpite = {
      matchId: idNum,
      winner: winner,
      scoreA: Number(scoreA),
      scoreB: Number(scoreB),
      qualifier: validQualifier,
      points: 0,
      pointsBreakdown: {
        exactScore: 0, scoreTeamA: 0, scoreTeamB: 0, winner: 0, qualifier: 0
      }
    };

    if (!betDoc) {
      betDoc = new Bet({
        user: req.user._id,
        leagueId: String(leagueId),
        groupMatches: [novoPalpite],
        hasSubmitted: true,
        lastUpdate: now,
        firstSubmission: now
      });

      await User.findByIdAndUpdate(req.user._id, { $addToSet: { leagues: toLeagueId(leagueId) } });
    } else {
      const index = betDoc.groupMatches.findIndex(b => Number(b.matchId) === idNum);

      if (index !== -1) {
        betDoc.groupMatches[index].winner = winner;
        betDoc.groupMatches[index].scoreA = Number(scoreA);
        betDoc.groupMatches[index].scoreB = Number(scoreB);
        betDoc.groupMatches[index].qualifier = validQualifier;
        betDoc.groupMatches[index].points = 0;
        betDoc.groupMatches[index].pointsBreakdown = novoPalpite.pointsBreakdown;
      } else {
        betDoc.groupMatches.push(novoPalpite);
      }

      betDoc.lastUpdate = now;
    }

    await betDoc.save();

    return res.json({
      success: true,
      message: 'Palpite individual salvo com sucesso!'
    });

  } catch (error) {
    console.error('POST /single error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpite individual.' });
  }
});

/* ================================================================
   🏆 GET /leaderboard (Filtrado por Liga)
   ================================================================ */

router.get('/leaderboard', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId, type } = req.query;
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    const isPartialRequest = type === 'partial';

    const [matches, bets, settings] = await Promise.all([
      Match.find({ leagueId: toLeagueId(leagueId) }).select('matchId status scoreA scoreB regularTimeScoreA regularTimeScoreB phase qualifiedSide').lean(),
      Bet.find({ hasSubmitted: true, leagueId: lIdStr }).populate('user', 'name avatar').lean(),
      Settings.findById(toLeagueId(leagueId)).lean()
    ]);

    const matchMap = new Map(matches.map(m => [String(m.matchId), m]));

    const ranked = bets.map((b) => {
  const computed = computeBetTotal(b, matchMap, settings, isPartialRequest);

  // Pontuações extras individuais.
  // Preferimos o breakdown calculado, mas usamos o breakdown
  // persistido da aposta como fallback.
  const extrasBreakdown =
    computed.extrasBreakdown ||
    b.extrasBreakdown ||
    {};

  return {
    user: b.user,
    totalPoints: computed.totalPoints,
    groupPhasePoints: computed.groupPhasePoints,
    knockoutPoints: computed.knockoutPoints,
    podiumPoints: computed.podiumPoints,

    // Extras individuais
    topScorerPoints: Number(extrasBreakdown.topScorer || 0),
    bestAttackPoints: Number(extrasBreakdown.bestAttack || 0),
    worstDefensePoints: Number(extrasBreakdown.worstDefense || 0),
    upsetPoints: Number(extrasBreakdown.upset || 0),

    // Mantém o total agregado das extras
    extrasPoints: computed.extrasPoints,

    bonusPoints: computed.bonusPoints,
    lastUpdate: computed.lastUpdate
  };
});

    ranked.sort((a, b) => b.totalPoints - a.totalPoints || (a.user?.name || "").localeCompare(b.user?.name || ""));

    let lastPoints = null;
    let position = 0;
    const finalData = ranked.map((item, index) => {
      if (lastPoints === null || item.totalPoints !== lastPoints) {
        position = index + 1;
        lastPoints = item.totalPoints;
      }
      return { ...item, position };
    });

    res.json({ success: true, data: finalData, leagueId: lIdNum });
  } catch (e) {
    console.error('Leaderboard Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao processar ranking' });
  }
});

/* ================================================================
   👁️ GET /all-bets (Com trava de visibilidade por liga)
   ================================================================ */

router.get('/all-bets', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const {
      search,
      matchId,
      group,
      leagueId
    } = req.query;

    const isAdmin = req.user?.isAdmin === true;

    const configId = toLeagueId(leagueId);

    // ============================================================
    // CONFIGURAÇÕES DA LIGA
    // ============================================================
    const settings =
      await Settings.findById(configId).lean();

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Configurações da liga não encontradas'
      });
    }

    const unlockedPhases =
      settings.unlockedPhases || [];

    // ============================================================
    // FILTRO DE PARTIDAS
    // ============================================================
    let matchFilter = {};

    if (leagueId) {
      matchFilter.leagueId =
        toLeagueId(leagueId);
    }

    if (group) {
      matchFilter.$or = [
        {
          group: {
            $regex: group,
            $options: 'i'
          }
        },
        {
          phaseName: {
            $regex: group,
            $options: 'i'
          }
        }
      ];
    }

    if (matchId) {
      matchFilter.matchId =
        Number(matchId);
    }

    const matches =
      await Match.find(matchFilter).lean();

    const matchIdsFilter =
      matches.map(m => m.matchId);

    if (matchIdsFilter.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    // ============================================================
    // FILTRO DE USUÁRIOS / APOSTAS
    // ============================================================
    const query = {
      hasSubmitted: true
    };

    if (search) {
      const users =
        await User.find({
          name: {
            $regex: search,
            $options: 'i'
          }
        })
        .select('_id')
        .lean();

      query.user = {
        $in: users.map(u => u._id)
      };
    }

    if (leagueId) {
      query.$or = [
        {
          leagueId:
            String(leagueId)
        },
        {
          leagueId:
            Number(leagueId)
        }
      ];
    }

    query['groupMatches.matchId'] = {
      $in: matchIdsFilter
    };

    const bets =
      await Bet.find(query)
        .populate('user', 'name')
        .lean();

    // ============================================================
    // MAPA DAS PARTIDAS
    // ============================================================
    const matchMap =
      new Map(
        matches.map(m => [
          String(m.matchId),
          m
        ])
      );

    // ============================================================
    // ENRIQUECIMENTO
    // ============================================================
    const enriched = bets.map(b => {

      // ----------------------------------------------------------
      // PARTIDAS DO USUÁRIO DENTRO DO FILTRO
      // ----------------------------------------------------------
      const gm =
        (b.groupMatches || [])
          .filter(x =>
            matchIdsFilter.includes(
              x.matchId
            )
          );

      const viewBets =
        gm.map(g => {

          const m =
            matchMap.get(
              String(g.matchId)
            );

          let isLocked = !isAdmin;

          if (
            m?.phase === 'group' ||
            m?.phase === 'pontos_corridos'
          ) {

            const groupUnlocked =
              unlockedPhases.includes(
                'group'
              );

            const specificGroupUnlocked =
              unlockedPhases.includes(
                m?.group
              );

            const phaseNameUnlocked =
              unlockedPhases.includes(
                m?.phaseName
              );

            isLocked =
              !isAdmin &&
              !groupUnlocked &&
              !specificGroupUnlocked &&
              !phaseNameUnlocked;

          } else {

            isLocked =
              !isAdmin &&
              !unlockedPhases.includes(
                m?.group
              );
          }

          return {
            matchId: g.matchId,

            scoreA: g.scoreA,
            scoreB: g.scoreB,

            choice:
              isLocked
                ? '🔒'
                : g.winner,

            choiceLabel:
              isLocked
                ? 'Bloqueado'
                : toWinnerLabel(
                    g.winner,
                    m?.teamA,
                    m?.teamB
                  ),

            matchName:
              m
                ? `${m.teamA} vs ${m.teamB}`
                : `Jogo ${g.matchId}`,

            status:
              m?.status ||
              'scheduled',

            qualifier:
              isLocked
                ? null
                : g.qualifier
          };
        });

      // ----------------------------------------------------------
      // VISIBILIDADE DO PÓDIO E EXTRAS
      // ----------------------------------------------------------
      const isPodiumLocked =
        !isAdmin &&
        !unlockedPhases.includes(
          'podium'
        );

      const finalPodium =
        (
          b.podium &&
          b.podium.length > 0 &&
          !isPodiumLocked
        )
          ? b.podium
          : (
              b.podium &&
              b.podium.length > 0
                ? Array(
                    b.podium.length
                  ).fill('🔒')
                : null
            );

      const finalExtras =
        (
          b.extras &&
          !isPodiumLocked
        )
          ? b.extras
          : null;

      // ----------------------------------------------------------
      // RECÁLCULO OFICIAL DOS PONTOS
      // ----------------------------------------------------------
      //
      // Usa exatamente as regras/resultados atuais da liga.
      // Isso evita depender de totalPoints antigo gravado no Bet.
      //
      const computed =
        computeBetTotal(
          b,
          matchMap,
          settings,
          false
        );

      // ----------------------------------------------------------
      // EXTRAS BREAKDOWN
      // ----------------------------------------------------------
      //
      // O computeBetTotal() calcula extrasPoints oficialmente.
      // Aqui também geramos o breakdown para o frontend.
      //
      let finalExtrasBreakdown = null;

      if (!isPodiumLocked && b.extras) {

        const rules = {
          ...DEFAULT_SCORING,
          ...(settings?.scoringRules || {})
        };

        const champResults =
          settings?.championshipResults || {};

        const extrasCalc =
          calcExtrasPoints(
            b.extras,
            champResults,
            rules
          );

        finalExtrasBreakdown =
          extrasCalc.breakdown;
      }

      // ----------------------------------------------------------
      // RETORNO DO USUÁRIO
      // ----------------------------------------------------------
      return {
        userName:
          b.user?.name ||
          'Usuário',

        // PONTUAÇÃO ATUALIZADA
        totalPoints:
          computed.totalPoints,

        groupPhasePoints:
          computed.groupPhasePoints,

        knockoutPoints:
          computed.knockoutPoints,

        podiumPoints:
          computed.podiumPoints,

        extrasPoints:
          computed.extrasPoints,

        bonusPoints:
          computed.bonusPoints,

        bets:
          viewBets,

        podium:
          finalPodium,

        extras:
          finalExtras,

        extrasBreakdown:
          finalExtrasBreakdown,

        lastUpdate:
          computed.lastUpdate
      };
    });

    // ============================================================
    // RESPOSTA
    // ============================================================
    return res.json({
      success: true,
      data: enriched
    });

  } catch (e) {

    console.error(
      'All-bets error:',
      e
    );

    return res.status(500).json({
      success: false,
      message:
        'Erro ao carregar apostas'
    });
  }
});
/* ================================================================
   🔍 GET /matches-for-filter
   ================================================================ */

router.get('/matches-for-filter', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    let filter = {};
    if (leagueId) filter.leagueId = toLeagueId(leagueId);

    const matches = await Match.find(filter)
      .select('matchId teamA teamB group phase date leagueId')
      .sort('matchId')
      .lean();

    res.json({ success: true, data: matches });
  } catch (e) {
    console.error('Matches filter error:', e);
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
});

/* ================================================================
   ⚠️ POST /admin/reset-all
   ================================================================ */

router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'Informe o leagueId para resetar' });
    }

    const lidStr = toLeagueId(leagueId);

    const deleteBets = await Bet.deleteMany({ leagueId: lidStr });
    const deleteHistory = await PointsHistory.deleteMany({ leagueId: lidStr });
    const userUpdate = await User.updateMany(
      { leagues: lidStr },
      { $pull: { leagues: lidStr } }
    );

    console.log(`[Reset Liga ${leagueId}] Apostas: ${deleteBets.deletedCount} | Histórico: ${deleteHistory.deletedCount}`);

    res.json({
      success: true,
      message: `Reset concluído com sucesso!`,
      details: {
        betsRemoved: deleteBets.deletedCount,
        historyRecordsRemoved: deleteHistory.deletedCount,
        usersUnlinked: userUpdate.modifiedCount
      }
    });

  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ success: false, message: 'Erro interno ao realizar reset total da liga' });
  }
});

/* ================================================================
   👥 GET /users-for-filter
   ================================================================ */

router.get('/users-for-filter', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({
        success: false,
        message: 'O parâmetro leagueId é obrigatório para filtrar os usuários.'
      });
    }

    // 🆕 CORREÇÃO: leagues pode ser Number ou String no array do usuário
    const query = {
      $or: [
        { leagues: String(leagueId) },
        { leagues: Number(leagueId) }
      ]
    };

    const users = await User.find(query)
      .select('_id name')
      .sort('name')
      .lean();

    res.json({ success: true, data: users });
  } catch (e) {
    console.error('Erro na rota users-for-filter:', e.message);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários da liga' });
  }
});

/* ================================================================
   🔐 GET /more-access
   ================================================================ */

router.get('/more-access', protect, async (req, res) => {
  try {
    const isAdminUser = req.user?.isAdmin === true;
    if (isAdminUser) return res.json({ success: true, canAccessMore: true });
    const hasBets = await Bet.exists({ user: req.user._id, hasSubmitted: true });
    res.json({ success: true, canAccessMore: !!hasBets });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
