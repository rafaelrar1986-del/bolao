const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

const { sortMatchesChronologically } = require('../utils/matchSort');
const {
  getVisibilityLockState,
  getGlobalPredictionVisibilityState
} = require('../services/betVisibilityService');
const { getBetLockState } = require('../services/betLockService');

const {
  DEFAULT_SCORING,
  DEFAULT_CHAMPIONSHIP_RULES,
  calculateBetTotal,
  calculateMatchPoints,
  getMaxPointsPerMatch
} = require('../services/pointsService');
function strMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

async function getLeadershipPath(req, res) {
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
    // Teto máximo de pontuação por partida.
    // O leadership-path usa esse valor nos ghost points e nas margens de
    // perigo. Como o teto máximo possível precisa contemplar também a
    // pontuação de classificado, calculamos sobre uma partida de mata-mata.
    // A regra fica centralizada no pointsService.
    const maxPointsPerMatch = getMaxPointsPerMatch(
      scoringRules,
      champRules,
      'knockout'
    );

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

        const computed = calculateBetTotal(b, matchMap, settings, isLive);

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
          const computed = calculateBetTotal(b, matchMap, settings, isLive);
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

            const { points } = calculateMatchPoints(rivalPick, simulatedMatch, scoringRules, champRules);
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

    const isPodiumLocked = !isAdmin && getGlobalPredictionVisibilityState(
      settings,
      false,
      isViewingSelf
    ).locked;
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
            const { points } = calculateMatchPoints(targetPick, simulatedMatch, scoringRules, champRules);
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
            const { points } = calculateMatchPoints(rivalSimulatedPick, simulatedMatch, scoringRules, champRules);
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
            const { points } = calculateMatchPoints(rivalPick, simulatedMatch, scoringRules, champRules);
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
            const { points } = calculateMatchPoints(rivalPick, simulatedMatch, scoringRules, champRules);
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
      const { points } = calculateMatchPoints(targetPick, simulatedMatch, scoringRules, champRules);
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
      const isLocked = !isAdmin && getVisibilityLockState(
        m,
        settings,
        false,
        getBetLockState,
        isViewingSelf
      ).locked;
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
  }}

module.exports = { getLeadershipPath };
