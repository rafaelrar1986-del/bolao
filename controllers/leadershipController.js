const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

const { sortMatchesChronologically } = require('../utils/matchSort');
const { getEffectiveKnockoutFormat } = require('../utils/knockoutFormat');
const { getKnockoutConfrontationKey, validateHomeAwayLegs } = require('../utils/knockoutConfrontationKey');
const {
  getVisibilityLockState,
  getGlobalPredictionVisibilityState
} = require('../services/betVisibilityService');
const { getBetLockState } = require('../services/betLockService');
const {
  buildScenarioUniverse,
  isMatchInMiracleBettingScope,
  materializeScenarioConfrontations
} = require('../services/miracleScenarioService');
const { normalizeTieBreakers, getTieBreakerMetrics, compareBySportsRanking } = require('../services/rankingService');

const {
  DEFAULT_SCORING,
  DEFAULT_CHAMPIONSHIP_RULES,
  calculateBetTotal,
  calculateMatchPoints,
  getMaxPointsPerMatch,
  sanitizeGroupQualificationRules
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
        .select('matchId date time status scoreA scoreB regularTimeScoreA regularTimeScoreB penaltiesA penaltiesB phase teamA teamB logoA logoB group qualifiedSide qualifiedSideManuallySet stageFormat knockoutTieKey knockoutLeg knockoutExpectedLegs')
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

    // A Estratégia precisa saber quando o placar é um campo pontuável e
    // quando o vencedor deve ser derivado do placar. Mantemos exatamente as
    // mesmas regras utilizadas pelo pointsService.
    const matchRules = Array.isArray(scoringRules.matchRules) ? scoringRules.matchRules : [];
    const scoreRuleConditions = new Set([
      'exactScore',
      'scoreTeamA',
      'scoreTeamB',
      'scoreWinner',
      'scoreLoser',
      'totalGoals',
      'goalDifference'
    ]);
    const scoreRulePoints = matchRules.reduce((max, rule) => {
      const points = Number(rule?.points || 0);
      const hasScoreCondition = Array.isArray(rule?.conditions) &&
        rule.conditions.some(condition => scoreRuleConditions.has(condition));
      return hasScoreCondition && Number.isFinite(points) && points > 0
        ? Math.max(max, points)
        : max;
    }, 0);
    const legacyScorePoints = Math.max(
      Number(scoringRules.exactScore || 0),
      Number(scoringRules.scoreTeamA || 0),
      Number(scoringRules.scoreTeamB || 0)
    );
    const scoreScoring = {
      enabled: scoreRulePoints > 0 || legacyScorePoints > 0,
      points: Math.max(scoreRulePoints, legacyScorePoints)
    };
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
            let winner = simData.winner?.toLowerCase();
            const qualifier = simData.qualifier?.toUpperCase();
            const hasScoreA = Number.isInteger(simData.scoreA) && simData.scoreA >= 0;
            const hasScoreB = Number.isInteger(simData.scoreB) && simData.scoreB >= 0;

            // Um placar preenchido também constitui uma simulação. Quando
            // winnerFromScore está ativo, o vencedor é derivado do placar.
            if (!winner && hasScoreA && hasScoreB && champRules.winnerFromScore !== false) {
              winner = simData.scoreA > simData.scoreB ? 'a' : (simData.scoreB > simData.scoreA ? 'b' : 'draw');
            }

            if (winner || qualifier || hasScoreA || hasScoreB) {
              m.isSimulated = true;
              if (winner === 'a') {
                m.scoreA = hasScoreA ? simData.scoreA : 2;
                m.scoreB = hasScoreB ? simData.scoreB : 0;
              } else if (winner === 'b') {
                m.scoreA = hasScoreA ? simData.scoreA : 0;
                m.scoreB = hasScoreB ? simData.scoreB : 2;
              } else if (winner === 'draw') {
                m.scoreA = hasScoreA ? simData.scoreA : 1;
                m.scoreB = hasScoreB ? simData.scoreB : 1;
              } else {
                m.scoreA = hasScoreA ? simData.scoreA : null;
                m.scoreB = hasScoreB ? simData.scoreB : null;
              }

              if (m.scoreA != null && m.scoreB != null) {
                if (m.regularTimeScoreA == null) m.regularTimeScoreA = m.scoreA;
                if (m.regularTimeScoreB == null) m.regularTimeScoreB = m.scoreB;
              }

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
    // O Milagre só pode analisar apostas da fase/rodada atualmente liberada.
    // Uma rodada já iniciada continua válida para o cálculo dos palpites que
    // já foram feitos nela; o filtro abaixo controla apenas o escopo de aposta,
    // não o bloqueio temporal da partida.
    const mathFutureMatches = displayFutureMatches
      .filter(m => !m.isSimulated)
      .filter(m => !isMiracleMode || isMatchInMiracleBettingScope(m, settings));

    // Universo matematicamente válido do Milagre. Partidas sem estado simulável
    // ficam fora, sem inventar resultados. O universo normal de placares é 0x0
    // até 7x7 e respeita placar parcial, vencedor/classificado pré-existentes.
    const miracleUniverse = isMiracleMode
      ? buildScenarioUniverse(mathFutureMatches, champRules)
      : { included: [], excluded: [] };
    const miracleSearchMatches = miracleUniverse.included;

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
      if (isMiracleMode) {
        // Busca exata: somente combinações válidas entram no universo. A poda usa
        // limites superiores/inferiores de pontuação por partida; o resultado
        // final sempre passa pelo motor oficial de pontuação/ranking.
        const tieBreakers = normalizeTieBreakers(undefined, settings);
        const baseMatchMap = new Map(matches.map(m => [String(m.matchId), m]));
        const futureEntries = miracleSearchMatches;
        const targetBase = targetBet;
        const allUsers = bets.filter(b => b.user?._id).map(b => b.user._id.toString());
        // Base segura para Branch & Bound: somente pontuação que não depende
        // de resultados futuros. Pontos de pódio e de classificação de grupos
        // atuais são retirados porque podem mudar quando o cenário for aplicado.
        // Extras e bônus são fixos e permanecem na base.
        const fixedBaseTotals = new Map();
        for (const bet of bets) {
          const uid = bet.user._id.toString();
          const computed = calculateBetTotal(bet, baseMatchMap, settings, false);
          fixedBaseTotals.set(uid, Math.max(0,
            Number(computed.totalPoints || 0)
            - Number(computed.podiumPoints || 0)
            - Number(computed.groupQualificationPoints || 0)
          ));
        }

        // Limites seguros para pontos que não são atribuídos por partida.
        // O pódio pode variar com o cenário; usamos o máximo teórico do
        // campeonato para o alvo. Para o rival, o mínimo seguro é zero.
        const maxPodiumPoints = (scoringRules.podiumPoints || [])
          .slice(0, Math.max(0, Number(champRules.podiumSize ?? 4)))
          .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        const groupQualificationRules = sanitizeGroupQualificationRules(
          scoringRules.groupQualificationRules
        );
        const maxGroupQualificationPerUser = (bet) => {
          if (!groupQualificationRules.length) return 0;
          const maxRule = Math.max(...groupQualificationRules.map(r => Number(r.points) || 0), 0);
          // Uma equipe/predição satisfaz no máximo uma regra; multiplicar pelo
          // número de previsões é um teto seguro, ainda que deliberadamente amplo.
          return Math.max(0, (Array.isArray(bet?.groupPredictions) ? bet.groupPredictions.length : 0) * maxRule);
        };

        // Em confrontos ida/volta, o ponto de classificado só pode aparecer
        // depois que o confronto agregado for resolvido. Como cada perna futura
        // individualmente tem qualifier=null, o limite por partida não enxerga
        // esse ponto. Mantemos um teto separado, por confronto, para que o
        // Branch & Bound jamais pode uma solução válida por subestimar esse bônus.
        const futureHomeAwayQualifierBounds = new Map();
        const qualifierPointsPerMatch = Math.max(0, Number(scoringRules?.matchExtras?.qualifier) || 0);
        if (qualifierPointsPerMatch > 0) {
          // O teto precisa considerar confrontos cuja primeira perna já terminou
          // mas cuja segunda ainda é futura. Por isso os grupos são montados a
          // partir de TODAS as partidas da liga, e não somente futureEntries.
          const homeAwayGroups = new Map();
          for (const match of matches) {
            const isKO = match?.phase === 'knockout' || match?.phase === 'mata-mata';
            const format = getEffectiveKnockoutFormat(champRules || {}, match);
            if (!isKO || format !== 'home_away') continue;
            const key = getKnockoutConfrontationKey(match);
            if (!key) continue;
            if (!homeAwayGroups.has(key)) homeAwayGroups.set(key, []);
            homeAwayGroups.get(key).push(match);
          }

          const futureIds = new Set(futureEntries.map(({ match }) => String(match.matchId)));
          for (const [key, legs] of homeAwayGroups) {
            const legValidation = validateHomeAwayLegs(legs, 2);
            if (!legValidation.valid) continue; // configuração inválida não entra no teto
            const orderedLegs = [...legs].sort((a, b) => {
              const la = Number(a?.knockoutLeg);
              const lb = Number(b?.knockoutLeg);
              if (Number.isFinite(la) && Number.isFinite(lb) && la !== lb) return la - lb;
              return Number(a?.matchId || 0) - Number(b?.matchId || 0);
            });
            const firstLeg = orderedLegs[0];
            if (!firstLeg || !futureIds.has(String(firstLeg.matchId)) && !futureIds.has(String(orderedLegs[1]?.matchId))) continue;

            const complete = orderedLegs.every(m => m?.status === 'finished' && Number.isFinite(Number(m.scoreA)) && Number.isFinite(Number(m.scoreB)));
            if (complete) continue; // o ponto já está potencialmente definido oficialmente

            for (const bet of bets) {
              const uid = bet.user._id.toString();
              // O extra de classificado do confronto é lançado na primeira perna.
              // Mesmo que a primeira perna já esteja finished, o ponto continua
              // sendo potencial enquanto a segunda perna não terminou.
              const betOnFirstLeg = (bet.groupMatches || []).find(g => String(g.matchId) === String(firstLeg.matchId));
              if (!betOnFirstLeg || betOnFirstLeg.qualifier == null) continue;
              const current = futureHomeAwayQualifierBounds.get(uid) || 0;
              futureHomeAwayQualifierBounds.set(uid, current + qualifierPointsPerMatch);
            }
          }
        }

        const perMatchBounds = futureEntries.map(({ match, outcomes }) => {
          const mins = new Map();
          const maxs = new Map();
          for (const bet of bets) {
            const uid = bet.user._id.toString();
            let min = Infinity, max = -Infinity;
            const pick = (bet.groupMatches || []).find(g => String(g.matchId) === String(match.matchId));
            for (const outcome of outcomes) {
              const simulated = {
                ...match,
                status: 'finished',
                isSimulated: true,
                scoreA: outcome.scoreA,
                scoreB: outcome.scoreB,
                regularTimeScoreA: outcome.scoreA,
                regularTimeScoreB: outcome.scoreB,
                qualifiedSide: outcome.qualifier || null,
                penaltiesA: outcome.penaltiesA ?? null,
                penaltiesB: outcome.penaltiesB ?? null,
              scenarioConfrontationQualifier: outcome.qualifier === 'A' || outcome.qualifier === 'B'
            };
              const pts = pick ? Number(calculateMatchPoints(pick, simulated, scoringRules, champRules).points || 0) : 0;
              min = Math.min(min, pts);
              max = Math.max(max, pts);
            }
            mins.set(uid, Number.isFinite(min) ? min : 0);
            maxs.set(uid, Number.isFinite(max) ? max : 0);
          }
          return { mins, maxs };
        });

        const evaluateScenario = (choices) => {
          const scenarioMap = new Map(baseMatchMap);
          const miracleScopeMatchIds = new Set(
            futureEntries.map(({ match }) => String(match.matchId))
          );
          const byId = new Map();
          for (let i = 0; i < futureEntries.length; i++) {
            const entry = futureEntries[i];
            const outcome = choices[i];
            if (!outcome) continue;
            const simulated = {
              ...entry.match,
              status: 'finished',
              isSimulated: true,
              scoreA: outcome.scoreA,
              scoreB: outcome.scoreB,
              regularTimeScoreA: outcome.scoreA,
              regularTimeScoreB: outcome.scoreB,
              qualifiedSide: outcome.qualifier || null,
              penaltiesA: outcome.penaltiesA ?? null,
              penaltiesB: outcome.penaltiesB ?? null
            };
            scenarioMap.set(String(entry.match.matchId), simulated);
            byId.set(String(entry.match.matchId), outcome);
          }

          // Ida/volta é resolvida no nível do confronto. Se o agregado empatar
          // sem critério determinístico, o resolvedor cria os dois cenários A/B.
          const confrontationVariants = materializeScenarioConfrontations(
            scenarioMap,
            champRules,
            miracleScopeMatchIds
          );
          if (!confrontationVariants.length) return null;

          const evaluateVariant = (variant) => {
            const variantMap = variant.scenarioMap;

          // Pódio por cenário: nunca carregamos posições futuras de settings.podium.
          // Uma posição só entra no pódio do cenário quando a partida que a determina
          // está oficialmente encerrada ou foi materializada pela simulação. Assim,
          // pontos de pódio não são atribuídos com base em um pódio futuro/congelado.
          const scenarioHasFutureKnockout = futureEntries.some(({ match }) =>
            match.phase === 'knockout' || match.phase === 'mata-mata'
          );
          const scenarioPodium = scenarioHasFutureKnockout
            ? new Array(Math.max(0, Number(champRules.podiumSize ?? 4))).fill(null)
            : [...(settings.podium || [])];

          const materializePodiumMatch = (match, outcome) => {
            if (!match || !outcome) return;
            const g = String(match.group || '').trim();
            const isKO = match.phase === 'knockout' || match.phase === 'mata-mata';
            if (!isKO || !outcome.qualifier) return;
            const winnerTeam = outcome.qualifier === 'A' ? match.teamA : match.teamB;
            const loserTeam = outcome.qualifier === 'A' ? match.teamB : match.teamA;
            if (winnerTeam == null || loserTeam == null) return;

            if (g === 'Final' && scenarioPodium.length >= 2) {
              scenarioPodium[0] = winnerTeam;
              scenarioPodium[1] = loserTeam;
            } else if (g === '3º lugar' && scenarioPodium.length >= 4) {
              scenarioPodium[2] = winnerTeam;
              scenarioPodium[3] = loserTeam;
            }
          };

          // Primeiro materializa resultados oficiais já encerrados; depois aplica
          // os resultados escolhidos para este cenário. Isso evita que um pódio
          // antigo sobreviva quando a fase final ainda não o determinou.
          for (const match of matches) {
            if (match.status !== 'finished') continue;
            const isKO = match.phase === 'knockout' || match.phase === 'mata-mata';
            if (!isKO || !['Final', '3º lugar'].includes(String(match.group || '').trim())) continue;
            const a = Number(match.scoreA);
            const b = Number(match.scoreB);
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            const winner = a > b ? 'A' : b > a ? 'B' : null;
            const qualifier = match.qualifiedSide === 'A' || match.qualifiedSide === 'B'
              ? match.qualifiedSide
              : winner;
            if (qualifier) materializePodiumMatch(match, { qualifier });
          }

          for (const entry of futureEntries) {
            const outcome = byId.get(String(entry.match.matchId));
            const effective = variantMap.get(String(entry.match.matchId));
            const resolvedOutcome = effective && (effective.qualifiedSide === 'A' || effective.qualifiedSide === 'B')
              ? { ...outcome, qualifier: effective.qualifiedSide }
              : outcome;
            materializePodiumMatch(entry.match, resolvedOutcome);
          }

          const scenarioSettings = { ...settings, podium: scenarioPodium };
          const ranked = bets.map(bet => {
            const computed = calculateBetTotal(bet, variantMap, scenarioSettings, false);
            return {
              userId: bet.user._id.toString(),
              name: bet.user.name || '',
              totalPoints: Number(computed.totalPoints || 0),
              tieBreakerMetrics: getTieBreakerMetrics(bet, computed)
            };
          }).sort((a, b) => compareBySportsRanking(a, b, tieBreakers) || a.name.localeCompare(b.name));

          let pos = 0;
          let previous = null;
          const rankedWithPosition = ranked.map((item, index) => {
            const same = previous && compareBySportsRanking(previous, item, tieBreakers) === 0;
            if (!same) pos = index + 1;
            previous = item;
            return { ...item, position: pos };
          });
          const target = rankedWithPosition.find(r => r.userId === activeUserId);
          return {
            ranked: rankedWithPosition,
            targetPosition: target?.position || rankedWithPosition.length + 1,
            scenarioMap: variantMap,
            scenarioPodium,
            scenarioConfrontations: variant.confrontations || {}
          };
          };

          // Para uma mesma combinação de placares, todos os desempates válidos
          // do confronto ida/volta também fazem parte do universo.
          let fallback = null;
          for (const variant of confrontationVariants) {
            const result = evaluateVariant(variant);
            if (!fallback) fallback = result;
            if (result && result.targetPosition === 1) return result;
          }
          return fallback;
        };

        const upperBoundCanStillWin = (depth, partialTotals) => {
          // Branch & Bound seguro: target recebe teto de TODAS as fontes que
          // ainda podem variar; cada rival recebe piso das fontes futuras.
          // Não usamos uma estimativa otimista do ranking: só podaremos quando
          // for matematicamente impossível o alvo superar o rival.
          const targetId = activeUserId;
          const targetBetForBound = betsByUserMap.get(targetId);
          let targetUpper = Number(partialTotals.get(targetId) || 0);
          for (let i = depth; i < perMatchBounds.length; i++) {
            targetUpper += perMatchBounds[i].maxs.get(targetId) || 0;
          }
          targetUpper += maxPodiumPoints + maxGroupQualificationPerUser(targetBetForBound);
          // Pontos de classificado de ida/volta são resolvidos somente no
          // confronto completo; adicionamos o teto correspondente ao alvo.
          targetUpper += futureHomeAwayQualifierBounds.get(targetId) || 0;

          for (const rivalId of allUsers) {
            if (rivalId === targetId) continue;
            let rivalLower = Number(partialTotals.get(rivalId) || 0);
            for (let i = depth; i < perMatchBounds.length; i++) {
              rivalLower += perMatchBounds[i].mins.get(rivalId) || 0;
            }
            // Pódio/classificação futuros podem zerar; portanto não somamos
            // qualquer parcela variável ao piso do rival.
            if (targetUpper < rivalLower) return false;
          }
          return true;
        };

        const scenarioChoices = [];
        let foundScenario = null;
        const partialTotals = new Map(allUsers.map(id => [
          id,
          Number(fixedBaseTotals.get(id) || 0)
        ]));
        // NÃO usamos memoização por depth + pontuação parcial.
        // O estado futuro do campeonato também depende das escolhas anteriores
        // (por exemplo, ida/volta, classificados e pódio). Duas sequências podem
        // ter os mesmos totais e ainda assim representar estados matematicamente
        // diferentes. A única poda aceita aqui é Branch & Bound comprovadamente
        // segura.
        let visitedNodes = 0;
        let prunedNodes = 0;

        // DFS exato sobre o universo válido. A avaliação de ranking só ocorre
        // nas folhas; a poda acima é apenas uma impossibilidade matemática segura.
        const dfs = (depth) => {
          if (foundScenario) return true;
          visitedNodes++;
          if (depth === futureEntries.length) {
            const result = evaluateScenario(scenarioChoices);
            if (result && result.targetPosition === 1) {
              foundScenario = { ...result, choices: scenarioChoices.map(x => ({ ...x })) };
              return true;
            }
            return false;
          }
          if (!upperBoundCanStillWin(depth, partialTotals)) {
            prunedNodes++;
            return false;
          }

          const { match, outcomes } = futureEntries[depth];
          const orderedOutcomes = outcomes
            .map((outcome, originalIndex) => {
              const simulated = {
                ...match,
                status: 'finished', isSimulated: true,
                scoreA: outcome.scoreA, scoreB: outcome.scoreB,
                regularTimeScoreA: outcome.scoreA, regularTimeScoreB: outcome.scoreB,
                qualifiedSide: outcome.qualifier || null,
                penaltiesA: outcome.penaltiesA ?? null,
                penaltiesB: outcome.penaltiesB ?? null,
              scenarioConfrontationQualifier: outcome.qualifier === 'A' || outcome.qualifier === 'B'
            };
              const targetPick = (targetBet.groupMatches || [])
                .find(g => String(g.matchId) === String(match.matchId));
              const targetDelta = targetPick
                ? Number(calculateMatchPoints(targetPick, simulated, scoringRules, champRules).points || 0)
                : 0;
              return { outcome, originalIndex, targetDelta };
            })
            .sort((a, b) => b.targetDelta - a.targetDelta || a.originalIndex - b.originalIndex)
            .map(item => item.outcome);

          for (const outcome of orderedOutcomes) {
            scenarioChoices[depth] = outcome;
            const deltas = [];
            for (const bet of bets) {
              const uid = bet.user._id.toString();
              const pick = (bet.groupMatches || []).find(g => String(g.matchId) === String(match.matchId));
              const simulated = {
                ...match,
                status: 'finished', isSimulated: true,
                scoreA: outcome.scoreA, scoreB: outcome.scoreB,
                regularTimeScoreA: outcome.scoreA, regularTimeScoreB: outcome.scoreB,
                qualifiedSide: outcome.qualifier || null,
                penaltiesA: outcome.penaltiesA ?? null,
                penaltiesB: outcome.penaltiesB ?? null,
              scenarioConfrontationQualifier: outcome.qualifier === 'A' || outcome.qualifier === 'B'
            };
              const delta = pick ? Number(calculateMatchPoints(pick, simulated, scoringRules, champRules).points || 0) : 0;
              partialTotals.set(uid, (partialTotals.get(uid) || 0) + delta);
              deltas.push([uid, delta]);
            }
            if (dfs(depth + 1)) return true;
            for (const [uid, delta] of deltas) partialTotals.set(uid, (partialTotals.get(uid) || 0) - delta);
          }
          return false;
        };

        // Se não há partidas simuláveis, a posição atual é a posição final.
        const baseScenario = evaluateScenario([]);
        if (futureEntries.length === 0) {
          foundScenario = baseScenario && baseScenario.targetPosition === 1 ? { ...baseScenario, choices: [] } : null;
        } else {
          dfs(0);
        }

        // O retorno step-by-step representa o cenário efetivamente encontrado,
        // não os palpites do target. Assim o Milagre não fabrica um cenário a
        // partir da aposta do usuário.
        if (foundScenario) {
          console.log(`✅ [MILAGRE] cenário encontrado após ${visitedNodes} nós; ${prunedNodes} podados.`);
          for (let i = 0; i < futureEntries.length; i++) {
            const entry = futureEntries[i];
            const outcome = foundScenario.choices[i];
            if (!outcome) continue;
            const midStr = String(entry.match.matchId);
            const scenarioResolvedQualifier = foundScenario.scenarioMap?.get(midStr)?.qualifiedSide;
            stepByStepSimulations[midStr] = {
              winner: outcome.winner,
              qualifier: (scenarioResolvedQualifier === 'A' || scenarioResolvedQualifier === 'B')
                ? scenarioResolvedQualifier
                : (outcome.qualifier || null),
              scoreA: outcome.scoreA,
              scoreB: outcome.scoreB,
              isCritical: false,
              impact: null
            };
          }

          // Necessidade matemática: uma partida só é crítica se NÃO existir
          // nenhum outro cenário completo, respeitando todas as restrições,
          // que leve o alvo ao 1º lugar sem o resultado encontrado para ela.
          //
          // A implementação anterior alterava somente a partida em questão e
          // mantinha todas as outras escolhas do primeiro cenário. Isso mede
          // dependência local, não necessidade global. Aqui fazemos uma nova
          // busca de existência por partida, usando o mesmo Branch & Bound da
          // busca principal. A busca para assim que encontra UMA alternativa.
          const outcomeSignature = (outcome) => JSON.stringify([
            outcome?.scoreA ?? null,
            outcome?.scoreB ?? null,
            outcome?.winner ?? null,
            outcome?.qualifier ?? null
          ]);

          const findAlternativeWinningScenario = (forbiddenIndex, forbiddenOutcome) => {
            const choices = [];
            const partial = new Map(allUsers.map(id => [
              id,
              Number(fixedBaseTotals.get(id) || 0)
            ]));
            // Também não memoizamos estados da busca alternativa por
            // depth + totais. As escolhas anteriores podem alterar confrontos
            // futuros, portanto essa equivalência não é válida para o solver.
            const forbiddenSig = outcomeSignature(forbiddenOutcome);

            const canStillWin = (depth) => {
              const targetId = activeUserId;
              const targetBetForBound = betsByUserMap.get(targetId);
              let targetUpper = Number(partial.get(targetId) || 0);
              for (let j = depth; j < perMatchBounds.length; j++) {
                targetUpper += perMatchBounds[j].maxs.get(targetId) || 0;
              }
              targetUpper += maxPodiumPoints + maxGroupQualificationPerUser(targetBetForBound);
          // Pontos de classificado de ida/volta são resolvidos somente no
          // confronto completo; adicionamos o teto correspondente ao alvo.
          targetUpper += futureHomeAwayQualifierBounds.get(targetId) || 0;

              for (const rivalId of allUsers) {
                if (rivalId === targetId) continue;
                let rivalLower = Number(partial.get(rivalId) || 0);
                for (let j = depth; j < perMatchBounds.length; j++) {
                  rivalLower += perMatchBounds[j].mins.get(rivalId) || 0;
                }
                if (targetUpper < rivalLower) return false;
              }
              return true;
            };

            const dfsAlternative = (depth) => {
              if (depth === futureEntries.length) {
                const result = evaluateScenario(choices);
                if (result && result.targetPosition === 1) return true;
                return false;
              }

              if (!canStillWin(depth)) {
                return false;
              }

              const { match, outcomes } = futureEntries[depth];
              let candidates = outcomes;
              if (depth === forbiddenIndex) {
                candidates = outcomes.filter(o => outcomeSignature(o) !== forbiddenSig);
              }
              if (!candidates.length) {
                return false;
              }

              const ordered = candidates
                .map((outcome, originalIndex) => {
                  const simulated = {
                    ...match,
                    status: 'finished', isSimulated: true,
                    scoreA: outcome.scoreA, scoreB: outcome.scoreB,
                    regularTimeScoreA: outcome.scoreA, regularTimeScoreB: outcome.scoreB,
                    qualifiedSide: outcome.qualifier || null,
                    penaltiesA: outcome.penaltiesA ?? null,
                    penaltiesB: outcome.penaltiesB ?? null,
                    scenarioConfrontationQualifier: outcome.qualifier === 'A' || outcome.qualifier === 'B'
                  };
                  const targetPick = (targetBet.groupMatches || [])
                    .find(g => String(g.matchId) === String(match.matchId));
                  const targetDelta = targetPick
                    ? Number(calculateMatchPoints(targetPick, simulated, scoringRules, champRules).points || 0)
                    : 0;
                  return { outcome, originalIndex, targetDelta };
                })
                .sort((a, b) => b.targetDelta - a.targetDelta || a.originalIndex - b.originalIndex)
                .map(x => x.outcome);

              for (const outcome of ordered) {
                choices[depth] = outcome;
                const deltas = [];
                for (const bet of bets) {
                  const uid = bet.user._id.toString();
                  const pick = (bet.groupMatches || [])
                    .find(g => String(g.matchId) === String(match.matchId));
                  const simulated = {
                    ...match,
                    status: 'finished', isSimulated: true,
                    scoreA: outcome.scoreA, scoreB: outcome.scoreB,
                    regularTimeScoreA: outcome.scoreA, regularTimeScoreB: outcome.scoreB,
                    qualifiedSide: outcome.qualifier || null,
                    penaltiesA: outcome.penaltiesA ?? null,
                    penaltiesB: outcome.penaltiesB ?? null,
                    scenarioConfrontationQualifier: outcome.qualifier === 'A' || outcome.qualifier === 'B'
                  };
                  const delta = pick
                    ? Number(calculateMatchPoints(pick, simulated, scoringRules, champRules).points || 0)
                    : 0;
                  partial.set(uid, (partial.get(uid) || 0) + delta);
                  deltas.push([uid, delta]);
                }

                if (dfsAlternative(depth + 1)) return true;
                for (const [uid, delta] of deltas) {
                  partial.set(uid, (partial.get(uid) || 0) - delta);
                }
              }

              return false;
            };

            return dfsAlternative(0);
          };

          const criticalIds = new Set();
          const alternativeOutcomes = new Map();

          for (let i = 0; i < futureEntries.length; i++) {
            const entry = futureEntries[i];
            const original = foundScenario.choices[i];
            if (!original) continue;

            const hasAlternative = findAlternativeWinningScenario(i, original);
            if (hasAlternative) {
              alternativeOutcomes.set(String(entry.match.matchId), true);
              // Existe outro cenário completo sem este resultado: o resultado
              // encontrado para esta partida NÃO é matematicamente necessário.
              continue;
            }

            criticalIds.add(String(entry.match.matchId));
          }

          for (const [midStr, data] of Object.entries(stepByStepSimulations)) {
            data.isCritical = criticalIds.has(midStr);
          }
          miracleCriticalMatches = criticalIds.size;
          miracleAchieved = true;
        } else {
          console.log(`ℹ️ [MILAGRE] nenhum cenário encontrado; ${visitedNodes} nós visitados, ${prunedNodes} podados.`);
          miracleAchieved = false;
        }
      } else {
        // Modo simulação continua usando exclusivamente os resultados informados pelo usuário.
        const placarDinamico = {};
        const basePointsMap = {};
        bets.forEach(b => {
          const betUserId = b.user?._id?.toString();
          if (!betUserId) return;
          const computed = calculateBetTotal(b, matchMap, settings, isLive);
          basePointsMap[betUserId] = computed.totalPoints;
        });
        Object.assign(placarDinamico, basePointsMap);

        for (const m of matches.filter(x => x.isSimulated).sort(sortMatchesChronologically)) {
          const midStr = String(m.matchId);
          const simData = parsedSimulations[midStr];
          if (!simData) continue;
          const before = getRankingSnapshot(placarDinamico);
          for (const bet of bets) {
            const uid = bet.user._id.toString();
            const pick = (bet.groupMatches || []).find(g => String(g.matchId) === midStr);
            if (!pick) continue;
            const { points } = calculateMatchPoints(pick, m, scoringRules, champRules);
            placarDinamico[uid] = (placarDinamico[uid] || 0) + points;
          }
          const after = getRankingSnapshot(placarDinamico);
          stepByStepSimulations[midStr] = {
            winner: simData.winner || null,
            qualifier: simData.qualifier || null,
            scoreA: simData.scoreA ?? null,
            scoreB: simData.scoreB ?? null,
            isCritical: before.targetPosition !== after.targetPosition,
            impact: { posBefore: before.targetPosition, posAfter: after.targetPosition, gapBefore: before.gapToLeader, gapAfter: after.gapToLeader, type: after.targetPosition < before.targetPosition ? 'positive' : after.targetPosition > before.targetPosition ? 'negative' : 'neutral' }
          };
        }
      }
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
        isViewingSelf,
        new Date(),
        matches
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
        scoreScoring,
        winnerFromScore: champRules.winnerFromScore !== false,
        hasImpact,
        isMiracleResult,
        isCriticalForMiracle: miracleData ? !!miracleData.isCritical : false,
        miracleImpact,
        miracleChoice,
        miracleQualifier,
        miracleScoreA: miracleData ? (miracleData.scoreA ?? null) : null,
        miracleScoreB: miracleData ? (miracleData.scoreB ?? null) : null,
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
