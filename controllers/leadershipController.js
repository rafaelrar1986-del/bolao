const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

const { sortMatchesChronologically } = require('../utils/matchSort');
const { getEffectiveKnockoutFormat, isFinalStage } = require('../utils/knockoutFormat');
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
const { normalizeTieBreakers, getTieBreakerMetrics, compareBySportsRanking, assignSportsPositions } = require('../services/rankingService');
const { calculateStrategyNonMatchFuturePotential } = require('../services/strategyFuturePotential');
const { calculateStructuralGroupQualificationMaximum, calculateStructuralKnockoutFuturePotential, calculateStructuralChampionshipCeiling, calculateFixedPickMaximum } = require('../services/strategyCeilingService');
const { getPointsRunStructure, getGroupStructure, getUnmaterializedRoundRobinMatchCount } = require('../services/championshipStructureService');

const {
  sanitizeScoringRules,
  sanitizeChampionshipRules,
  calculateBetTotal,
  calculateMatchPoints,
  getMaxPointsPerMatch,
  sanitizeGroupQualificationRules,
  getGroupCompletionStatus,
  resolveKnockoutConfrontationQualifier
} = require('../services/pointsService');
function strMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function getMatchResult(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  if (na > nb) return 'A';
  if (nb > na) return 'B';
  return 'draw';
}

function getQualifiedSideForSingleMatch(match, matchResult) {
  if (match?.qualifiedSide === 'A' || match?.qualifiedSide === 'B') return match.qualifiedSide;
  if (match?.penaltiesA != null && match?.penaltiesB != null) {
    const pa = Number(match.penaltiesA);
    const pb = Number(match.penaltiesB);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa > pb ? 'A' : 'B';
  }
  return matchResult === 'A' || matchResult === 'B' ? matchResult : null;
}

// Mantém a métrica de desempate de placar exatamente alinhada ao pointsService.
// Algumas regras novas armazenam a pontuação de exactScore em matchRulePoints
// quando a condição exata é atingida; olhar apenas breakdown.exactScore faria
// a Estratégia perder esse desempate.
function getExactScoreMetricFromResult(result) {
  if (Array.isArray(result?.breakdown?.matchedConditions) &&
      result.breakdown.matchedConditions.includes('exactScore')) {
    return Number(result.breakdown?.matchRulePoints || 0);
  }
  return Number(result?.breakdown?.exactScore || 0);
}

// O cálculo isolado usado pelos limites da Estratégia nunca deve atribuir
// novamente o bônus de classificado de uma confrontação ida/volta. O bônus
// desse formato é resolvido pelo confronto completo e tratado separadamente
// em futureHomeAwayQualifierBounds. Para jogo único, o motor oficial continua
// recebendo o qualifier normalmente.
function calculateStrategyMatchOutcomeResult(pick, simulatedMatch, scoringRules, championshipRules) {
  if (!pick || !simulatedMatch) {
    return { points: 0, breakdown: {} };
  }
  const isKnockout = simulatedMatch.phase === 'knockout' || simulatedMatch.phase === 'mata-mata';
  if (isKnockout && getEffectiveKnockoutFormat(championshipRules || {}, simulatedMatch) === 'home_away') {
    return calculateMatchPoints(
      { ...pick, qualifier: null },
      simulatedMatch,
      scoringRules,
      championshipRules
    );
  }
  return calculateMatchPoints(pick, simulatedMatch, scoringRules, championshipRules);
}

function calculateStrategyMatchOutcomePoints(pick, simulatedMatch, scoringRules, championshipRules) {
  return Number(calculateStrategyMatchOutcomeResult(
    pick, simulatedMatch, scoringRules, championshipRules
  ).points || 0);
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
        .select('matchId date time status scoreA scoreB regularTimeScoreA regularTimeScoreB penaltiesA penaltiesB phase phaseName roundNumber roundName teamA teamB logoA logoB group qualifiedSide qualifiedSideManuallySet stageFormat knockoutTieKey knockoutLeg knockoutExpectedLegs')
        .lean(),
      Bet.find({ hasSubmitted: true, $or: [{ leagueId: lIdStr }, { leagueId: lIdNum }] })
        .select('user groupMatches groupPredictions matchId podium extras bonusPoints')
        .populate('user', 'name')
        .lean()
    ]);

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Configurações da liga não encontradas' });
    }

    const scoringRules = sanitizeScoringRules(settings.scoringRules);
    const champRules = sanitizeChampionshipRules(settings.championshipRules);
    const hasThirdPlaceMatch = champRules.hasThirdPlaceMatch === true;
    const champResults = settings.championshipResults || {};
    const officialPodium = settings.podium || [];
    const podiumSize = champRules.podiumSize ?? 4;
    const prizeZonePositions = Math.max(0, Math.floor(Number(settings.prizeZone?.positions ?? 0)));
    // A zona de premiação é configurável. Zero significa que não há zona ativa;
    // não inventamos um Top 2 no backend, pois o frontend usa a mesma fonte.
    const awardZonePositions = prizeZonePositions;
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
    let parsedSimulations = {};
    if (mode === 'simulacao' && simulations && simulations.length < 50000) {
      try {
        const rawSimulations = JSON.parse(simulations);
        // O frontend bloqueia requests até o card estar completo. O backend
        // repete a mesma validação para impedir que um payload manual/antigo
        // transforme um card parcial em resultado simulado. Cards incompletos
        // são simplesmente ignorados e não contaminam o restante do cenário.
        const validSimulations = {};
        matches.forEach(m => {
          const midStr = String(m.matchId);
          const simData = rawSimulations?.[midStr];
          if (!simData || typeof simData !== 'object' || m.status === 'finished') return;

          const isKnockout = m.phase === 'knockout' || m.phase === 'mata-mata';
          const format = getEffectiveKnockoutFormat(champRules, m);
          const knockoutLeg = Number(m.knockoutLeg || 0);
          const isReturnLeg = isKnockout && format === 'home_away' && knockoutLeg === 2;
          const hasWinner = ['a', 'b', 'draw'].includes(String(simData.winner || '').trim().toLowerCase());
          const hasQualifier = ['A', 'B'].includes(String(simData.qualifier || '').trim().toUpperCase());
          const hasScoreA = Number.isInteger(simData.scoreA) && simData.scoreA >= 0 && simData.scoreA <= 99;
          const hasScoreB = Number.isInteger(simData.scoreB) && simData.scoreB >= 0 && simData.scoreB <= 99;
          const scoreRequired = champRules.winnerFromScore !== false || scoreScoring.enabled;
          const requiresWinner = champRules.winnerFromScore === false;
          const requiresQualifier = isKnockout && !isReturnLeg;

          if (scoreRequired && (!hasScoreA || !hasScoreB)) return;
          if (requiresWinner && !hasWinner) return;
          if (requiresQualifier && !hasQualifier) return;

          validSimulations[midStr] = simData;
        });
        parsedSimulations = validSimulations;
        matches.forEach(m => {
          const midStr = String(m.matchId);
          const simData = parsedSimulations[midStr];
          if (simData && m.status !== 'finished') {
            let winner = simData.winner?.toLowerCase();
            const qualifier = simData.qualifier?.toUpperCase();
            const hasScoreA = Number.isInteger(simData.scoreA) && simData.scoreA >= 0;
            const hasScoreB = Number.isInteger(simData.scoreB) && simData.scoreB >= 0;

            // Um placar preenchido também constitui uma simulação. Quando
            // winnerFromScore está ativo, o placar é a fonte única do vencedor;
            // um winner enviado pelo cliente não pode contradizê-lo.
            if (hasScoreA && hasScoreB && champRules.winnerFromScore !== false) {
              winner = simData.scoreA > simData.scoreB ? 'a' : (simData.scoreB > simData.scoreA ? 'b' : 'draw');
            }

            // Em mata-mata de jogo único, um vencedor não-empatado determina
            // o classificado. Em ida/volta, uma perna isolada nunca determina
            // o classificado; o confronto precisa ser resolvido em conjunto.
            let effectiveQualifier = qualifier;
            if ((m.phase === 'knockout' || m.phase === 'mata-mata') &&
                getEffectiveKnockoutFormat(champRules, m) === 'single' &&
                (winner === 'a' || winner === 'b')) {
              effectiveQualifier = winner.toUpperCase();
            }

            if (winner || effectiveQualifier || hasScoreA || hasScoreB) {
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

              if (effectiveQualifier === 'A') m.qualifiedSide = 'A';
              if (effectiveQualifier === 'B') m.qualifiedSide = 'B';
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

    // Descobre a primeira etapa do mata-mata pela cronologia real das partidas,
    // nunca por uma tabela fixa de quotas. Isso permite que o ADM use outro
    // número de classificados ou nomes de fases sem quebrar a Estratégia.
    const knockoutMatches = matches.filter(m => m.phase === 'knockout' || m.phase === 'mata-mata');
    const knockoutStageInfo = new Map();
    for (const m of knockoutMatches) {
      const stage = String(m.group || '').trim();
      if (!stage) continue;
      const current = knockoutStageInfo.get(stage) || { firstTime: Number.MAX_SAFE_INTEGER, teams: new Set() };
      const parsedTime = (() => {
        const [d, mo, y] = String(m.date || '').split('/').map(Number);
        const [hh, mm] = String(m.time || '00:00').split(':').map(Number);
        return d && mo && y ? new Date(y, mo - 1, d, hh || 0, mm || 0).getTime() : Number.MAX_SAFE_INTEGER;
      })();
      current.firstTime = Math.min(current.firstTime, parsedTime);
      if (m.teamA) current.teams.add(String(m.teamA));
      if (m.teamB) current.teams.add(String(m.teamB));
      knockoutStageInfo.set(stage, current);
    }

    const initialKnockoutGroup = [...knockoutStageInfo.entries()]
      .sort((a, b) => a[1].firstTime - b[1].firstTime || a[0].localeCompare(b[0]))[0]?.[0] || null;

    if (initialKnockoutGroup) {
      const initialMatches = knockoutMatches.filter(m => String(m.group || '').trim() === initialKnockoutGroup);
      const teamsInKnockout = new Set();
      initialMatches.forEach(m => {
        if (m.teamA) teamsInKnockout.add(String(m.teamA));
        if (m.teamB) teamsInKnockout.add(String(m.teamB));
      });
      if (teamsInKnockout.size > 0) {
        matches.forEach(m => {
          if (m.phase !== 'group') return;
          if (m.teamA && !teamsInKnockout.has(String(m.teamA))) eliminatedTeams.add(m.teamA);
          if (m.teamB && !teamsInKnockout.has(String(m.teamB))) eliminatedTeams.add(m.teamB);
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
      if (['Semifinal', 'Final'].includes(m.group) || (hasThirdPlaceMatch && m.group === '3º lugar')) {
        const isMatchValid = isLive ? (m.status !== 'scheduled' || m.isSimulated) : (m.status === 'finished' || m.isSimulated);

        if (isMatchValid) {
          const effectiveFormat = getEffectiveKnockoutFormat(champRules, m);
          let winnerTeam = null;
          let loserTeam = null;

          if (effectiveFormat === 'home_away') {
            // Em ida/volta, nenhuma perna isolada determina o vencedor do
            // confronto. O pódio/eliminados só são atualizados quando o
            // resolvedor agregado consegue fechar as duas pernas (ou quando
            // uma simulação já materializou um confronto completo). Durante
            // o LIVE, uma perna empatada/pendente não pode fabricar um
            // semifinalista/finalista a partir do placar parcial.
            const resolved = resolveKnockoutConfrontationQualifier(m, matchMap, champRules);
            if (resolved === 'A') { winnerTeam = m.teamA; loserTeam = m.teamB; }
            else if (resolved === 'B') { winnerTeam = m.teamB; loserTeam = m.teamA; }
          } else {
            const realWinner = getMatchResult(m.scoreA, m.scoreB);
            const realQual = getQualifiedSideForSingleMatch(m, realWinner);
            if (realQual === 'A') {
              winnerTeam = m.teamA; loserTeam = m.teamB;
            } else if (realQual === 'B') {
              winnerTeam = m.teamB; loserTeam = m.teamA;
            } else if (isLive && liveStatuses.includes(m.status)) {
              const ra = Number(m.scoreA), rb = Number(m.scoreB);
              if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) {
                winnerTeam = ra > rb ? m.teamA : m.teamB;
                loserTeam = ra > rb ? m.teamB : m.teamA;
              }
            }
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

    const tieBreakers = normalizeTieBreakers(undefined, settings);

    // ---------- RANKING ATUAL (com regras dinâmicas) ----------
    const currentRanking = bets
      .map(b => {
        const betUserId = b.user?._id?.toString();
        if (!betUserId) return null;

        const computed = calculateBetTotal(b, matchMap, settings, isLive);

        const groupQualificationByGroup = {};
        for (const item of (computed.groupQualificationBreakdown || [])) {
          const group = String(item?.group || '').trim();
          if (!group) continue;
          groupQualificationByGroup[group] =
            (groupQualificationByGroup[group] || 0) + Math.max(0, Number(item?.points) || 0);
        }

        return {
          userId: betUserId,
          points: computed.totalPoints,
          groupPhasePoints: computed.groupPhasePoints,
          knockoutPoints: computed.knockoutPoints,
          podiumPoints: computed.podiumPoints,
          extrasPoints: computed.extrasPoints,
          exactScorePoints: computed.exactScorePoints,
          bonusPoints: computed.bonusPoints,
          groupQualificationByGroup,
          groupQualificationPoints: computed.groupQualificationPoints,
          name: b.user?.name || ''
        };
      })
      .filter(Boolean);

    const currentRankingWithTieMetrics = currentRanking.map(item => ({
      ...item,
      totalPoints: item.points,
      tieBreakerMetrics: {
        exactScorePoints: Number(item.exactScorePoints || 0),
        podiumPoints: Number(item.podiumPoints || 0),
        extraPoints: Number(item.extrasPoints || 0),
        knockoutPoints: Number(item.knockoutPoints || 0)
      }
    }));
    const sortedCurrentRanking = [...currentRankingWithTieMetrics].sort((a, b) =>
      compareBySportsRanking(a, b, tieBreakers) || a.name.localeCompare(b.name)
    );

    const targetPoints = sortedCurrentRanking.find(r => r.userId === activeUserId)?.points || 0;
    const leaderPoints = sortedCurrentRanking[0]?.points || 0;

    const rankedCurrentWithPositions = assignSportsPositions(sortedCurrentRanking.map(item => ({
      ...item,
      __rankingTieKey: tieBreakers.map(key => Number(item.tieBreakerMetrics?.[key] || 0)).join('|')
    })));
    const currentTarget = rankedCurrentWithPositions.find(r => r.userId === activeUserId);
    const currentPosition = currentTarget?.position || rankedCurrentWithPositions.length + 1;
    const simulatedRankingList = rankedCurrentWithPositions.map(item => ({
      position: item.position,
      userId: item.userId,
      points: item.points,
      name: item.name
    }));

    const positionMap = new Map();
    simulatedRankingList.forEach(r => positionMap.set(r.userId, r.position));

    const displayFutureMatches = matches
      .filter(m => {
        if (m.isSimulated) return true;
        if (m.status === 'finished') return false;
        // Official: all unfinished matches remain future opportunities.
        // Live: scheduled and in-progress matches remain visible; the current
        // score is handled by calculateBetTotal(..., true) and by the LIVE
        // scenario helpers below.
        if (!isLive) return true;
        return m.status === 'scheduled' || liveStatuses.includes(m.status);
      })
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

    // ---------- GHOST POINTS (mata-mata futuro) ----------
    // O teto é derivado da estrutura real do campeonato. Não existe mais uma
    // tabela fixa (16/8/4/2/1/1): o número de jogos por etapa é calculado a
    // partir dos times realmente presentes e, quando uma etapa ainda não foi
    // materializada, a quantidade de classificados do ADM é usada apenas para
    // projetar o bracket padrão. O bônus de classificado de ida/volta é contado
    // uma única vez por confronto, nunca uma vez por perna.
    const strategyGhostPointsByUser = new Map();
    const nowForGhost = new Date();
    const targetPickIdsByUser = new Map();
    for (const bet of bets) {
      const uid = bet.user?._id?.toString();
      if (!uid) continue;
      targetPickIdsByUser.set(uid, new Set(
        (bet.groupMatches || []).map(gm => String(gm.matchId))
      ));
      strategyGhostPointsByUser.set(uid, 0);
    }

    const stageExpectedMatches = new Map();

    // A quantidade esperada de jogos de cada etapa é derivada dos próprios
    // confrontos materializados. Cada confronto carrega knockoutExpectedLegs
    // (ou pode ser derivado da regra do ADM), portanto não precisamos assumir
    // 32/16/8/4/2, nem uma quantidade fixa de equipes por etapa.
    //
    // Importante: não inventamos uma etapa que ainda não possui nenhuma
    // partida materializada. Nesse caso não existe uma partida concreta à qual
    // atribuir ghost points. Quando uma etapa já começou a ser materializada,
    // contamos as pernas faltantes de cada confronto pelo knockoutTieKey.
    for (const [stage] of knockoutStageInfo.entries()) {
      const stageMatches = knockoutMatches.filter(m => String(m.group || '').trim() === stage);
      if (!stageMatches.length) continue;

      const ties = new Map();
      for (const match of stageMatches) {
        const key = match.knockoutTieKey || getKnockoutConfrontationKey(match) || `match::${match.matchId}`;
        const format = getEffectiveKnockoutFormat(champRules, match);
        const expectedLegs = Number(match.knockoutExpectedLegs) === 2
          ? 2
          : (format === 'home_away' ? 2 : 1);
        const entry = ties.get(String(key)) || { expectedLegs, matches: 0 };
        entry.expectedLegs = Math.max(entry.expectedLegs, expectedLegs);
        entry.matches += 1;
        ties.set(String(key), entry);
      }

      const expected = [...ties.values()].reduce(
        (sum, tie) => sum + Math.max(1, tie.expectedLegs),
        0
      );
      stageExpectedMatches.set(stage, Math.max(stageMatches.length, expected));
    }

    // Não fabricamos etapas com base em uma tabela fixa de 32/16/8/4/2.
    // A geração das partidas é a fonte de verdade da estrutura do mata-mata.
    // Os números definidos pelo ADM (times, grupos e classificados) determinam
    // quais confrontos o gerador deve materializar; a Estratégia apenas mede
    // o inventário real dessa liga e as pernas efetivamente previstas nele.

    if (champRules?.hasKnockoutPhase === true && stageExpectedMatches.size > 0) {
      for (const [stage, expectedMatches] of stageExpectedMatches.entries()) {
        const phaseMatches = knockoutMatches.filter(m => String(m.group || '').trim() === stage);

        // Partidas de mata-mata já materializadas, mas ainda não encerradas,
        // continuam fazendo parte do teto completo. O teto da partida é
        // calculado independentemente de ela estar liberada neste instante;
        // a Estratégia mede o máximo final alcançável no campeonato.
        // Somamos apenas o teto das PERNAS materializadas ainda abertas.
        // O bônus de classificado em ida/volta pertence ao confronto e deve
        // entrar uma única vez, nunca uma vez por perna. As pernas que ainda
        // não existem são tratadas pelo solver estrutural abaixo.
        const openTies = new Map();
        for (const match of phaseMatches) {
          if (match.status === 'finished') continue;
          const key = match.knockoutTieKey || getKnockoutConfrontationKey(match) || `match::${match.matchId}`;
          const format = getEffectiveKnockoutFormat(champRules, match);
          const entry = openTies.get(String(key)) || { sample: match, format, openLegs: 0 };
          entry.openLegs += 1;
          openTies.set(String(key), entry);
        }
        for (const { sample, format, openLegs } of openTies.values()) {
          const baseRules = format === 'home_away'
            ? { ...scoringRules, matchExtras: { ...(scoringRules?.matchExtras || {}), qualifier: 0 } }
            : scoringRules;
          let maxForTie = 0;
          for (const openMatch of phaseMatches.filter(m => {
            const key = m.knockoutTieKey || getKnockoutConfrontationKey(m) || `match::${m.matchId}`;
            return String(key) === String(sample.knockoutTieKey || getKnockoutConfrontationKey(sample) || `match::${sample.matchId}`) && m.status !== 'finished';
          })) {
            maxForTie += getMaxPointsPerMatch(baseRules, champRules, openMatch);
          }
          if (format === 'home_away') {
            maxForTie += Math.max(0, Number(scoringRules?.matchExtras?.qualifier || 0));
          }
          if (maxForTie <= 0) continue;
          for (const [tieKey, tieData] of openTies.entries()) {
            if (tieData.sample !== sample) continue;
            const tieMatches = phaseMatches.filter(m => String(m.knockoutTieKey || getKnockoutConfrontationKey(m) || `match::${m.matchId}`) === String(tieKey));
            const started = tieMatches.some(m => {
              const lock = getBetLockState(m, settings, nowForGhost, matches);
              return ['match_started', 'grade_started'].includes(lock.reason);
            });
            for (const uid of strategyGhostPointsByUser.keys()) {
              const userPickIds = targetPickIdsByUser.get(uid) || new Set();
              const hasAnyPickInTie = tieMatches.some(m => userPickIds.has(String(m.matchId)));
              // Se o confronto já começou e o usuário não possui nenhuma aposta
              // nele, a oportunidade de pontuar foi perdida. Rodadas apenas
              // bloqueadas administrativamente/por liberação futura continuam
              // potencialmente apostáveis e permanecem no teto.
              if (started && !hasAnyPickInTie) continue;
              let userOpenPotential = 0;
              for (const openMatch of tieMatches) {
                if (openMatch.status === 'finished') continue;
                const pick = (betsByUserMap.get(uid)?.groupMatches || []).find(gm => String(gm.matchId) === String(openMatch.matchId));
                const lock = getBetLockState(openMatch, settings, nowForGhost, matches);
                if (pick && lock.locked) {
                  const openBaseRules = format === 'home_away'
                    ? { ...scoringRules, matchExtras: { ...(scoringRules?.matchExtras || {}), qualifier: 0 } }
                    : scoringRules;
                  userOpenPotential += calculateFixedPickMaximum(pick, openMatch, openBaseRules, champRules);
                } else {
                  userOpenPotential += getMaxPointsPerMatch(
                    format === 'home_away'
                      ? { ...scoringRules, matchExtras: { ...(scoringRules?.matchExtras || {}), qualifier: 0 } }
                      : scoringRules,
                    champRules,
                    openMatch
                  );
                }
              }
              if (format === 'home_away') {
                const firstLeg = tieMatches.find(m => Number(m.knockoutLeg) === 1) || tieMatches[0];
                const firstPick = (betsByUserMap.get(uid)?.groupMatches || []).find(gm => String(gm.matchId) === String(firstLeg?.matchId));
                if (firstPick?.qualifier != null) {
                  userOpenPotential += Math.max(0, Number(scoringRules?.matchExtras?.qualifier || 0));
                }
              }
              strategyGhostPointsByUser.set(uid, (strategyGhostPointsByUser.get(uid) || 0) + userOpenPotential);
            }
          }
        }

        // Para partidas ainda não materializadas, derivamos exatamente quais
        // pernas faltam em cada confronto materializado. Isso evita o erro de
        // atribuir o bônus de classificado à perna 2 ou de assumir que todo
        // bloco faltante contém um par completo de partidas.
        const ties = new Map();
        for (const match of phaseMatches) {
          const key = match.knockoutTieKey || getKnockoutConfrontationKey(match) || `match::${match.matchId}`;
          const format = getEffectiveKnockoutFormat(champRules, match);
          const expectedLegsForTie = Number(match.knockoutExpectedLegs) === 2
            ? 2
            : (format === 'home_away' ? 2 : 1);
          const entry = ties.get(String(key)) || {
            sample: match,
            expectedLegs: expectedLegsForTie,
            legs: new Set()
          };
          entry.expectedLegs = Math.max(entry.expectedLegs, expectedLegsForTie);
          const leg = Number(match.knockoutLeg);
          if (entry.expectedLegs === 1) {
            entry.legs.add(1);
          } else if (Number.isFinite(leg) && leg >= 1 && leg <= entry.expectedLegs) {
            entry.legs.add(leg);
          } else {
            // Dados legados sem knockoutLeg: cada documento já representa uma
            // perna materializada. Não inventamos qual perna é; se faltar uma
            // perna, usamos o maior teto possível entre as duas posições.
            entry.legs.add(entry.legs.size + 1);
          }
          ties.set(String(key), entry);
        }

        // As pernas ainda não materializadas também precisam ser calculadas
        // individualmente. Se o confronto já começou e o usuário não possui
        // nenhuma aposta nele, a oportunidade foi perdida e nenhuma perna
        // futura pode entrar no teto desse usuário. Se o confronto ainda está
        // aberto (ou o usuário já possui aposta no confronto), as pernas
        // faltantes continuam alcançáveis.
        for (const tie of ties.values()) {
          const format = getEffectiveKnockoutFormat(champRules, tie.sample);
          const expectedLegsForTie = tie.expectedLegs;
          const presentLegs = [...tie.legs];
          const missingLegs = [];
          for (let leg = 1; leg <= expectedLegsForTie; leg++) {
            if (!presentLegs.includes(leg)) missingLegs.push(leg);
          }
          if (!missingLegs.length) continue;

          const tieMatches = phaseMatches.filter(m =>
            String(m.knockoutTieKey || getKnockoutConfrontationKey(m) || `match::${m.matchId}`) ===
            String(tie.sample.knockoutTieKey || getKnockoutConfrontationKey(tie.sample) || `match::${tie.sample.matchId}`)
          );
          const started = tieMatches.some(m => {
            const lock = getBetLockState(m, settings, nowForGhost, matches);
            return ['match_started', 'grade_started'].includes(lock.reason);
          });

          for (const uid of strategyGhostPointsByUser.keys()) {
            const userPickIds = targetPickIdsByUser.get(uid) || new Set();
            const hasAnyPickInTie = tieMatches.some(m => userPickIds.has(String(m.matchId)));
            if (started && !hasAnyPickInTie) continue;

            let userMissingPotential = 0;
            for (const leg of missingLegs) {
              userMissingPotential += getMaxPointsPerMatch(
                scoringRules,
                champRules,
                { ...tie.sample, phase: 'knockout', knockoutLeg: format === 'home_away' ? leg : 1 }
              );
            }

            // Em ida/volta, o bônus de classificado pertence ao confronto,
            // não à perna. Se ainda existe uma perna faltante, o bônus ainda
            // pode ser obtido e precisa entrar uma única vez.
            if (format === 'home_away') {
              const hasOpenMaterializedLeg = tieMatches.some(m => m.status !== 'finished');
              // Se já existe uma perna materializada e aberta, o bloco de
              // openTies acima já acrescentou o bônus do confronto. Quando
              // todas as pernas materializadas estão encerradas e ainda falta
              // uma perna, o bônus continua futuro e precisa ser acrescentado
              // aqui, uma única vez.
              if (!hasOpenMaterializedLeg) {
                userMissingPotential += Math.max(0, Number(scoringRules?.matchExtras?.qualifier || 0));
              }
            }

            strategyGhostPointsByUser.set(
              uid,
              (strategyGhostPointsByUser.get(uid) || 0) + userMissingPotential
            );
          }
        }
      }
    }

    const targetGhostPoints = strategyGhostPointsByUser.get(activeUserId) || 0;

    // ---------- TETO ESTRUTURAL DE ROUND-ROBIN NÃO MATERIALIZADO ----------
    // O ADM pode liberar partidas rodada a rodada. Portanto, o número total de
    // times/legs não obriga o robô a criar todas as partidas antecipadamente.
    // Para a Estratégia, porém, essas regras definem o universo total do
    // campeonato e, consequentemente, quantos jogos ainda podem gerar pontos.
    // Contamos apenas partidas realmente materializadas; o restante é um teto
    // estrutural e não depende de documentos futuros existirem no MongoDB.
    const strategyRoundRobinUnmaterializedPointsByUser = new Map();
    for (const bet of bets) {
      const uid = bet.user?._id?.toString();
      if (uid) strategyRoundRobinUnmaterializedPointsByUser.set(uid, 0);
    }

    if (champRules?.hasGroupPhase === true) {
      const groupStructure = getGroupStructure(champRules);
      if (groupStructure.expectedMatches > 0 && groupStructure.divisible) {
        const materializedGroupMatches = matches.filter(m => String(m.phase || '').trim().toLowerCase() === 'group');
        const missingGroupMatches = getUnmaterializedRoundRobinMatchCount(
          groupStructure.expectedMatches,
          materializedGroupMatches
        );
        const groupMax = getMaxPointsPerMatch(scoringRules, champRules, { phase: 'group' });
        const missingPoints = missingGroupMatches * groupMax;
        if (missingPoints > 0) {
          for (const uid of strategyRoundRobinUnmaterializedPointsByUser.keys()) {
            strategyRoundRobinUnmaterializedPointsByUser.set(uid, missingPoints);
          }
        }
      }
    } else if (champRules?.hasGroupPhase === false && champRules?.hasKnockoutPhase === false) {
      const pointsRunStructure = getPointsRunStructure(champRules);
      if (pointsRunStructure.expectedMatches > 0) {
        const materializedPointsRunMatches = matches.filter(m => {
          const phase = String(m.phase || '').trim().toLowerCase();
          return phase === 'pontos_corridos' || phase === 'points_run';
        });
        const missingPointsRunMatches = getUnmaterializedRoundRobinMatchCount(
          pointsRunStructure.expectedMatches,
          materializedPointsRunMatches
        );
        const pointsRunMax = getMaxPointsPerMatch(scoringRules, champRules, { phase: 'pontos_corridos' });
        const missingPoints = missingPointsRunMatches * pointsRunMax;
        if (missingPoints > 0) {
          for (const uid of strategyRoundRobinUnmaterializedPointsByUser.keys()) {
            strategyRoundRobinUnmaterializedPointsByUser.set(uid, missingPoints);
          }
        }
      }
    }

    // ---------- POTENCIAL FUTURO FORA DE PARTIDAS ----------
    // Centraliza as fontes que o teto da Estratégia precisa considerar além de
    // partidas/ghosts. O total atual já contém resultados oficiais; aqui entram
    // apenas pontos que ainda podem nascer no futuro.
    const groupCompletionByGroup = new Map(
      getGroupCompletionStatus(matches, champRules).map(state => [String(state.group), state])
    );
    const strategyGroupQualificationRules = sanitizeGroupQualificationRules(
      scoringRules.groupQualificationRules
    );
    const strategyFutureNonMatchPotential = new Map();
    for (const bet of bets) {
      const uid = bet.user?._id?.toString();
      if (!uid) continue;
      const currentRankingEntry = currentRanking.find(r => r.userId === uid);
      strategyFutureNonMatchPotential.set(uid, calculateStrategyNonMatchFuturePotential(bet, {
        groupCompletionByGroup,
        groupQualificationRules: strategyGroupQualificationRules,
        scoringRules,
        championshipRules: champRules,
        championshipResults: champResults,
        hasGroupPhase: champRules?.hasGroupPhase !== false,
        currentGroupQualificationByGroup: currentRankingEntry?.groupQualificationByGroup || {}
      }));
    }
    const targetFutureNonMatch = strategyFutureNonMatchPotential.get(activeUserId) || { total: 0, groupQualificationPoints: 0, extraPoints: 0 };
    const targetFutureNonMatchPotential = Number(targetFutureNonMatch.total || 0);

    // Limite absoluto e dinâmico do campeonato. É calculado uma única vez a
    // partir das regras do ADM e reutilizado tanto para o alvo quanto para os
    // rivais, garantindo que uma consulta da Estratégia a outro participante
    // nunca use um teto estrutural diferente do teto daquele participante.
    const structuralChampionshipCeiling = calculateStructuralChampionshipCeiling(
      scoringRules,
      champRules
    );
    const structuralKnockoutUnmaterializedPotential = calculateStructuralKnockoutFuturePotential(
      matches,
      scoringRules,
      champRules
    );

    // O potencial de mata-mata é particionado em duas fontes disjuntas:
    // (1) pernas/confrontos materializados ainda abertos, em
    //     strategyGhostPointsByUser;
    // (2) confrontos ainda não materializados, no solver estrutural.
    // Nunca somamos um terceiro teto estrutural completo por usuário.
    const getUserKnockoutFuturePotential = (userId) => {
      const uid = String(userId || '');
      return Math.max(
        0,
        Number(strategyGhostPointsByUser.get(uid) || 0) +
        Number(structuralKnockoutUnmaterializedPotential || 0)
      );
    };

    // ---------- HELPERS DE RANKING SIMULADO ----------
    // A Estratégia deve usar exatamente as mesmas regras de desempate do ranking
    // oficial. O snapshot recebe também os indicadores de desempate dinâmicos,
    // porque somente o total de pontos não é suficiente para determinar a posição.
    const getRankingSnapshot = (pointsMap, tieMetricsMap = null) => {
      const list = Object.entries(pointsMap)
        .map(([userId, points]) => {
          const bet = betsByUserMap.get(userId);
          const base = currentRankingWithTieMetrics.find(r => r.userId === userId);
          const dynamicMetrics = tieMetricsMap?.get(userId);
          return {
            userId,
            points: Number(points || 0),
            totalPoints: Number(points || 0),
            name: bet?.user?.name || '',
            tieBreakerMetrics: dynamicMetrics || base?.tieBreakerMetrics || {
              exactScorePoints: 0,
              podiumPoints: 0,
              extraPoints: 0,
              knockoutPoints: 0
            }
          };
        })
        .sort((a, b) =>
          compareBySportsRanking(a, b, tieBreakers) ||
          a.name.localeCompare(b.name)
        );

      const ranked = assignSportsPositions(list.map(item => ({
        ...item,
        __rankingTieKey: tieBreakers
          .map(key => Number(item.tieBreakerMetrics?.[key] || 0))
          .join('|')
      })));

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
          if (champRules?.hasGroupPhase === false) return 0;
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
              const pts = pick ? Number(calculateStrategyMatchOutcomePoints(pick, simulated, scoringRules, champRules) || 0) : 0;
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
            if (!isKO || !(String(match.group || '').trim() === 'Final' || (hasThirdPlaceMatch && String(match.group || '').trim() === '3º lugar'))) continue;
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
                ? Number(calculateStrategyMatchOutcomePoints(targetPick, simulated, scoringRules, champRules) || 0)
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
              const delta = pick ? Number(calculateStrategyMatchOutcomePoints(pick, simulated, scoringRules, champRules) || 0) : 0;
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
                    ? Number(calculateStrategyMatchOutcomePoints(targetPick, simulated, scoringRules, champRules) || 0)
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
                    ? Number(calculateStrategyMatchOutcomePoints(pick, simulated, scoringRules, champRules) || 0)
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
        // Modo simulação: cada passo é recalculado pelo MESMO motor oficial
        // de pontuação. Isso é essencial para ida/volta, pódio dinâmico,
        // extras e regras customizadas: nunca somamos pontos de uma perna
        // isoladamente quando o resultado oficial depende do confronto.
        const baseSimulationMatchMap = new Map(
          matches.map(m => {
            if (!m.isSimulated) return [String(m.matchId), m];
            return [String(m.matchId), {
              ...m,
              status: 'scheduled',
              isSimulated: false,
              scoreA: null,
              scoreB: null,
              regularTimeScoreA: null,
              regularTimeScoreB: null,
              penaltiesA: null,
              penaltiesB: null,
              qualifiedSide: null
            }];
          })
        );

        const simulationEntries = matches
          .filter(m => m.isSimulated && parsedSimulations[String(m.matchId)])
          .sort(sortMatchesChronologically);

        const buildPrefixState = (prefixMatches) => {
          const rawMap = new Map(baseSimulationMatchMap);
          const scopeIds = new Set(prefixMatches.map(m => String(m.matchId)));
          for (const match of prefixMatches) {
            const simData = parsedSimulations[String(match.matchId)];
            if (!simData) continue;

            let winner = String(simData.winner || '').trim().toLowerCase();
            const scoreA = Number.isInteger(simData.scoreA) ? simData.scoreA : null;
            const scoreB = Number.isInteger(simData.scoreB) ? simData.scoreB : null;
            if (scoreA != null && scoreB != null && champRules.winnerFromScore !== false) {
              winner = scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : 'draw';
            }

            const effectiveQualifier =
              simData.qualifier === 'A' || simData.qualifier === 'B'
                ? simData.qualifier
                : null;

            rawMap.set(String(match.matchId), {
              ...match,
              status: 'finished',
              isSimulated: true,
              scoreA,
              scoreB,
              regularTimeScoreA: scoreA,
              regularTimeScoreB: scoreB,
              qualifiedSide: effectiveQualifier,
              penaltiesA: simData.penaltiesA ?? null,
              penaltiesB: simData.penaltiesB ?? null,
              scenarioConfrontationQualifier: effectiveQualifier === 'A' || effectiveQualifier === 'B'
            });
          }

          // O resolvedor compartilhado é a fonte de verdade para confrontos
          // ida/volta. Em confronto incompleto ele preserva qualifier=null;
          // em confronto completo materializa a decisão uma única vez.
          const variants = materializeScenarioConfrontations(
            rawMap,
            champRules,
            scopeIds
          );
          const variant = variants[0] || { scenarioMap: rawMap, confrontations: {} };
          return { scenarioMap: variant.scenarioMap, confrontations: variant.confrontations || {} };
        };

        const buildPrefixPodium = (scenarioMap) => {
          const size = Math.max(0, Math.floor(Number(champRules.podiumSize ?? 4)));
          const podium = new Array(size).fill(null);
          if (size === 0) return podium;

          const stageMatches = [...scenarioMap.values()]
            .filter(m => (m.phase === 'knockout' || m.phase === 'mata-mata') &&
              (String(m.group || '').trim() === 'Final' || (hasThirdPlaceMatch && String(m.group || '').trim() === '3º lugar')) &&
              (m.status === 'finished' || m.isSimulated))
            .sort(sortMatchesChronologically);

          for (const match of stageMatches) {
            const qualifier = match.qualifiedSide === 'A' || match.qualifiedSide === 'B'
              ? match.qualifiedSide
              : null;
            if (!qualifier) continue;
            const winnerTeam = qualifier === 'A' ? match.teamA : match.teamB;
            const loserTeam = qualifier === 'A' ? match.teamB : match.teamA;
            if (!winnerTeam || !loserTeam) continue;

            if (String(match.group || '').trim() === 'Final') {
              if (size >= 1) podium[0] = winnerTeam;
              if (size >= 2) podium[1] = loserTeam;
            } else if (String(match.group || '').trim() === '3º lugar') {
              if (size >= 3) podium[2] = winnerTeam;
              if (size >= 4) podium[3] = loserTeam;
            }
          }
          return podium;
        };

        const evaluateSimulationPrefix = (prefixMatches) => {
          const { scenarioMap } = buildPrefixState(prefixMatches);
          const scenarioPodium = buildPrefixPodium(scenarioMap);
          const scenarioSettings = { ...settings, podium: scenarioPodium };
          const rows = bets.map(bet => {
            const computed = calculateBetTotal(bet, scenarioMap, scenarioSettings, false);
            return {
              userId: bet.user._id.toString(),
              name: bet.user.name || '',
              points: Number(computed.totalPoints || 0),
              totalPoints: Number(computed.totalPoints || 0),
              tieBreakerMetrics: getTieBreakerMetrics(bet, computed)
            };
          }).sort((a, b) => compareBySportsRanking(a, b, tieBreakers) || a.name.localeCompare(b.name));

          const ranked = assignSportsPositions(rows.map(row => ({
            ...row,
            __rankingTieKey: tieBreakers
              .map(key => Number(row.tieBreakerMetrics?.[key] || 0))
              .join('|')
          })));
          const target = ranked.find(r => r.userId === activeUserId);
          const leader = ranked[0] || null;
          return {
            targetPosition: target?.position || ranked.length + 1,
            targetPoints: target?.points || 0,
            leaderPoints: leader?.points || 0,
            gapToLeader: (leader?.points || 0) - (target?.points || 0),
            ranked,
            scenarioMap,
            scenarioPodium
          };
        };

        let previous = evaluateSimulationPrefix([]);
        for (let i = 0; i < simulationEntries.length; i++) {
          const currentPrefix = simulationEntries.slice(0, i + 1);
          const after = evaluateSimulationPrefix(currentPrefix);
          const match = simulationEntries[i];
          const simData = parsedSimulations[String(match.matchId)] || {};
          stepByStepSimulations[String(match.matchId)] = {
            winner: simData.winner || null,
            qualifier: simData.qualifier || null,
            scoreA: simData.scoreA ?? null,
            scoreB: simData.scoreB ?? null,
            isCritical: previous.targetPosition !== after.targetPosition,
            impact: {
              posBefore: previous.targetPosition,
              posAfter: after.targetPosition,
              gapBefore: previous.gapToLeader,
              gapAfter: after.gapToLeader,
              type: after.targetPosition < previous.targetPosition
                ? 'positive'
                : after.targetPosition > previous.targetPosition
                  ? 'negative'
                  : 'neutral'
            }
          };
          previous = after;
        }
      }

    }

    // ---------- POTENCIAL DE PÓDIO E ELIMINAÇÕES POR USUÁRIO ----------
    const userPodiumPotentialMap = new Map();
    const userSpecificEliminatedMap = new Map();
    bets.forEach(b => {
      const betUserId = b.user?._id?.toString();
      if (!betUserId) return;

      let pot = 0;
      const userEliminatedTeams = new Set(eliminatedTeams);

      if (b.podium && b.podium.length > 0) {
        // Força matemática: eliminações diretas quando 2 times do pódio se enfrentam precocemente
        mathFutureMatches.forEach(m => {
          const isEarlyKnockout = (m.phase === 'knockout' || m.phase === 'mata-mata') &&
            !(['Semifinal', 'Final'].includes(m.group) || (hasThirdPlaceMatch && m.group === '3º lugar'));

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

      }

      userPodiumPotentialMap.set(betUserId, pot);
      userSpecificEliminatedMap.set(betUserId, userEliminatedTeams);
    });

    const targetPodiumPotential = userPodiumPotentialMap.get(activeUserId) || 0;
    const targetEliminatedTeams = userSpecificEliminatedMap.get(activeUserId) || eliminatedTeams;

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
      const projectedTieMetrics = {
        exactScorePoints: Number(r.exactScorePoints || 0),
        podiumPoints: Number(r.podiumPoints || 0),
        extraPoints: Number(r.extrasPoints || 0),
        knockoutPoints: Number(r.knockoutPoints || 0)
      };

      mathFutureMatches.forEach(m => {
        const midStr = String(m.matchId);
        const targetPick = targetPicksMap.get(midStr);
        const rivalPick = (bRef?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
        const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';

        // O teto/projeção do mata-mata futuro é calculado pelo par
        // ghost + solver estrutural. Não projetamos novamente a partida KO
        // aqui, pois isso duplicaria os pontos das partidas já materializadas.
        if (isKnockoutPhase) return;

        const projectionPick = isTarget ? targetPick : rivalPick;
        if (projectionPick) {
          // O Universo Perfeito é o cenário definido pelos próprios palpites
          // do alvo. Uma contradição entre o palpite de resultado e o pódio
          // reduz o potencial de pódio, mas NÃO elimina os pontos da partida.
          // Para os rivais, usamos exatamente o mesmo resultado do alvo; nunca
          // invertamos o resultado apenas porque há uma contradição de pódio.
          if (targetPick) {
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
            const result = calculateStrategyMatchOutcomeResult(projectionPick, simulatedMatch, scoringRules, champRules);
            projPts += Number(result.points || 0);
            projectedTieMetrics.exactScorePoints += getExactScoreMetricFromResult(result);
            if (isKnockoutPhase) projectedTieMetrics.knockoutPoints += Number(result.points || 0);
          }
        } else {
          // Se ainda não existe palpite, uma partida materializada e ainda
          // apostável continua fazendo parte da melhor projeção possível.
          // O caso de jogo/grade já iniciado sem palpite é oportunidade perdida
          // e não recebe pontos. Isso vale igualmente para alvo e rival.
          const lock = getBetLockState(m, settings, nowForGhost, matches);
          const opportunityLost = ['match_started', 'grade_started'].includes(lock.reason);
          if (!opportunityLost) {
            projPts += getMaxPointsPerMatch(scoringRules, champRules, m);
            if (isKnockoutPhase) {
              projectedTieMetrics.knockoutPoints += getMaxPointsPerMatch(scoringRules, champRules, m);
            }
          }
        }
      });

      if (isTarget) {
        const targetRoundRobinUnmaterialized = strategyRoundRobinUnmaterializedPointsByUser.get(r.userId) || 0;
        projPts += targetPodiumPotential + cappedGroupQualificationPotential + Number(targetFutureNonMatch.extraPoints || 0) + getUserKnockoutFuturePotential(r.userId) + targetRoundRobinUnmaterialized;
        projectedTieMetrics.podiumPoints += Number(targetPodiumPotential || 0);
        projectedTieMetrics.extraPoints += Number(targetFutureNonMatch.extraPoints || 0);
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

        const rivalFutureNonMatch = strategyFutureNonMatchPotential.get(r.userId) || { total: 0, groupQualificationPoints: 0, extraPoints: 0 };
        const rivalFutureNonMatchPotential = Number(rivalFutureNonMatch.total || 0);
        projPts += rivalPodiumInTargetUniverse + rivalFutureNonMatchPotential;
        projectedTieMetrics.podiumPoints += Number(rivalPodiumInTargetUniverse || 0);
        projectedTieMetrics.extraPoints += Number(rivalFutureNonMatch.extraPoints || 0);

        // Ghost é específico do rival: partidas materializadas e bloqueadas
        // só são ghost quando ele ainda não possui palpite; as partidas não
        // materializadas são comuns a todos.
        const rivalGhostPoints = strategyGhostPointsByUser.get(r.userId) || 0;
        const rivalRoundRobinUnmaterialized = strategyRoundRobinUnmaterializedPointsByUser.get(r.userId) || 0;
        projPts += getUserKnockoutFuturePotential(r.userId) + rivalRoundRobinUnmaterialized;
      }

      // O ranking projetado também não pode ultrapassar o teto estrutural do
      // campeonato. Isso é especialmente importante quando o alvo consulta
      // outro participante: todos os usuários são projetados sob a mesma
      // estrutura, mas cada um mantém seus próprios palpites e pontuação.
      if (structuralChampionshipCeiling > 0) {
        projPts = Math.max(Number(r.points || 0), Math.min(structuralChampionshipCeiling, projPts));
      }

      return {
        userId: r.userId,
        totalPoints: projPts,
        name: r.name,
        tieBreakerMetrics: projectedTieMetrics
      };
    });

    projectedRanking.sort((a, b) =>
      compareBySportsRanking(a, b, tieBreakers) || a.name.localeCompare(b.name)
    );
    const projectedWithPositions = assignSportsPositions(projectedRanking.map(item => ({
      ...item,
      __rankingTieKey: tieBreakers.map(key => Number(item.tieBreakerMetrics?.[key] || 0)).join('|')
    })));
    const targetUserProj = projectedWithPositions.find(r => r.userId === activeUserId);
    const targetMaxPosition = targetUserProj?.position || projectedWithPositions.length + 1;

    // ---------- TETO FUTURO DO ALVO ----------
    // Todas as fontes futuras passam pela mesma composição usada pela Estratégia.
    // Isso evita que status/posição usem um teto diferente do exibido no card.
    // O teto representa o máximo que ainda pode ser alcançado no campeonato
    // inteiro. Para partidas já materializadas e ainda não encerradas, qualquer
    // resultado futuro compatível com a partida pode ocorrer; portanto usamos
    // o teto da própria regra, e não a pontuação do palpite simulado. Partidas
    // ainda não materializadas são acrescentadas separadamente pelos tetos
    // estruturais de round-robin/mata-mata.
    const matchPointsLeft = mathFutureMatches.reduce((acc, m) => {
      const isKnockoutMatch = m.phase === 'knockout' || m.phase === 'mata-mata';
      if (isKnockoutMatch) return acc; // KO materializado é tratado pelo ghost/structural solver.
      const hasPick = targetPicksMap.has(String(m.matchId));
      const lock = getBetLockState(m, settings, new Date(), matches);
      const permanentlyClosedWithoutPick = !hasPick && ['match_started', 'grade_started'].includes(lock.reason);
      // O teto considera o campeonato completo: uma rodada ainda não liberada
      // continua potencialmente apostável no futuro. Só retiramos do teto uma
      // partida cuja oportunidade já foi perdida por início do jogo/grade.
      if (permanentlyClosedWithoutPick) return acc;
      if (hasPick && lock.locked) {
        const pick = targetPicksMap.get(String(m.matchId));
        return acc + calculateFixedPickMaximum(pick, m, scoringRules, champRules);
      }
      return acc + getMaxPointsPerMatch(scoringRules, champRules, m);
    }, 0);

    const structuralGroupQualificationMaximum = calculateStructuralGroupQualificationMaximum(scoringRules, champRules);
    const currentGroupQualificationPoints = Number(
      currentRanking.find(r => r.userId === activeUserId)?.groupQualificationPoints || 0
    );
    const cappedGroupQualificationPotential = structuralGroupQualificationMaximum > 0
      ? Math.min(
          Number(targetFutureNonMatch.groupQualificationPoints || 0),
          Math.max(0, structuralGroupQualificationMaximum - currentGroupQualificationPoints)
        )
      : Number(targetFutureNonMatch.groupQualificationPoints || 0);

    const rawTotalPotential =
      matchPointsLeft +
      targetPodiumPotential +
      cappedGroupQualificationPotential +
      Number(targetFutureNonMatch.extraPoints || 0) +
      getUserKnockoutFuturePotential(activeUserId) +
      (strategyRoundRobinUnmaterializedPointsByUser.get(activeUserId) || 0);

    // Limite matemático do campeonato inteiro. As fontes acima são deliberadamente
    // independentes (partidas materializadas, pernas faltantes, partidas futuras,
    // classificação, extras e pódio), portanto o teto estrutural funciona como
    // uma barreira final contra qualquer dupla contagem ou combinação impossível.
    // Nunca reduzimos pontos já conquistados: se dados históricos estiverem acima
    // do teto configurado, o maior valor alcançável continua sendo o atual.
    const targetMaxTotal = structuralChampionshipCeiling > 0
      ? Math.max(
          targetPoints,
          Math.min(structuralChampionshipCeiling, targetPoints + Math.max(0, rawTotalPotential))
        )
      : targetPoints + Math.max(0, rawTotalPotential);
    const totalPotential = Math.max(0, targetMaxTotal - targetPoints);

    // ---------- CENÁRIO PESSIMISTA ----------
    const worstCaseTargetPoints = targetMaxTotal;
    // Para garantir a melhor posição possível, o alvo precisa ser comparado
    // ao próprio TETO futuro, não aos pontos atuais. Um rival só pode ser
    // considerado capaz de permanecer à frente no pior caso se seu teto for
    // pelo menos igual ao teto do alvo.
    // O teto do alvo é calculado abaixo, antes deste bloco, para que a mesma
    // fonte de verdade seja usada tanto no status quanto na posição mínima.
    let usersBeatingTargetInWorstCase = 0;
    let maxRivalPotential = 0;

    currentRanking.forEach(r => {
      if (r.userId !== activeUserId) {
        const bRef = betsByUserMap.get(r.userId);
        let rivalMaxPts = Number(r.points || 0);
        // Para o pior caso, só usamos um teto de pontos totais. Não fabricamos
        // um cenário impossível combinando simultaneamente os máximos futuros
        // de exactScore, knockout, extras e pódio, pois esses máximos podem
        // depender de resultados incompatíveis entre si.
        const rivalMaxTieMetrics = {
          exactScorePoints: Number(r.exactScorePoints || 0),
          podiumPoints: Number(r.podiumPoints || 0),
          extraPoints: Number(r.extrasPoints || 0),
          knockoutPoints: Number(r.knockoutPoints || 0)
        };
        mathFutureMatches.forEach(m => {
          const midStr = String(m.matchId);
          const isKnockoutMatch = m.phase === 'knockout' || m.phase === 'mata-mata';
          // O KO materializado/futuro é calculado exclusivamente por ghost +
          // solver estrutural. Nunca o adicionamos neste loop de partidas.
          if (isKnockoutMatch) return;

          const rivalPick = (bRef?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
          const lock = getBetLockState(m, settings, nowForGhost, matches);
          const opportunityLost = !rivalPick && ['match_started', 'grade_started'].includes(lock.reason);

          // O teto do rival representa o máximo que ele ainda pode alcançar.
          // Portanto uma partida materializada e ainda apostável também é uma
          // oportunidade, mesmo que o rival ainda não tenha salvo um palpite.
          // Só retiramos a partida quando a oportunidade realmente foi perdida
          // (jogo/grade já iniciado sem palpite).
          if (opportunityLost) return;

          if (rivalPick && lock.locked) {
            rivalMaxPts += calculateFixedPickMaximum(rivalPick, m, scoringRules, champRules);
            return;
          }

          // Sem palpite ainda aberto, ou com palpite em uma partida ainda
          // apostável, usamos o teto máximo da regra da partida.
          rivalMaxPts += getMaxPointsPerMatch(scoringRules, champRules, m);
        });

        const rivalPodium = userPodiumPotentialMap.get(r.userId) || 0;
        const rivalFutureNonMatch = strategyFutureNonMatchPotential.get(r.userId) || { total: 0, groupQualificationPoints: 0, extraPoints: 0 };
        const rivalFutureNonMatchPotential = Number(rivalFutureNonMatch.total || 0);
        const rivalGhostPoints = strategyGhostPointsByUser.get(r.userId) || 0;
        const rivalRoundRobinUnmaterialized = strategyRoundRobinUnmaterializedPointsByUser.get(r.userId) || 0;
        rivalMaxPts += rivalPodium + rivalFutureNonMatchPotential + rivalGhostPoints + rivalRoundRobinUnmaterialized;
        rivalMaxTieMetrics.podiumPoints += Number(rivalPodium || 0);
        rivalMaxTieMetrics.extraPoints += Number(rivalFutureNonMatch.extraPoints || 0);

        // ghostPoints é um teto de PONTOS TOTAIS futuros. Como as partidas ainda
        // não foram liberadas/materializadas, não existe informação suficiente
        // para afirmar qual desempate futuro o rival terá. Para uma posição
        // garantida, um empate no teto também precisa ser tratado como ameaça:
        // o desempate futuro pode favorecer o rival. Assim evitamos construir
        // um ranking fictício somando máximos incompatíveis de vários critérios.

        // rivalMaxPts já contém rivalGhostPoints (KO materializado/aberto).
        // Acrescentamos somente o potencial estrutural dos confrontos ainda
        // não materializados; adicionar getUserKnockoutFuturePotential aqui
        // repetiria o ghost e inflaria o teto do rival.
        const rivalPotentialRaw = rivalMaxPts + structuralKnockoutUnmaterializedPotential;
        const rivalPotential = structuralChampionshipCeiling > 0
          ? Math.max(Number(r.points || 0), Math.min(structuralChampionshipCeiling, rivalPotentialRaw))
          : rivalPotentialRaw;
        if (rivalPotential > maxRivalPotential) maxRivalPotential = rivalPotential;

        // O limite inferior de posição é deliberadamente conservador. Se o rival
        // pode chegar a mais pontos, certamente pode terminar à frente. Se pode
        // chegar ao mesmo total, o desempate futuro é desconhecido e portanto
        // também não podemos garantir que o alvo ficará à frente.
        if (rivalPotential >= worstCaseTargetPoints) {
          usersBeatingTargetInWorstCase++;
        }
      }
    });

    const targetMinPosition = usersBeatingTargetInWorstCase + 1;

    // ---------- STATUS MATEMÁTICO ----------
    // targetMaxPosition é uma projeção baseada no universo de palpites do alvo;
    // ele não é suficiente para declarar eliminação. Para eliminar alguém de
    // forma segura, contamos apenas rivais que JÁ estão acima do teto total que
    // o alvo ainda pode atingir. Empates no teto não são tratados como prova de
    // eliminação porque desempates futuros ainda não foram liberados.
    const guaranteedOutsidePrizeZonePosition = 1 + currentRanking.filter(r =>
      r.userId !== activeUserId && Number(r.points || 0) > Number(targetMaxTotal || 0)
    ).length;

    let statusBadge = 'IN_CONTENTION';
    if (awardZonePositions > 0) {
      if (targetMinPosition <= awardZonePositions) {
        statusBadge = 'GUARANTEED_PODIUM';
      } else if (guaranteedOutsidePrizeZonePosition > awardZonePositions) {
        statusBadge = 'ELIMINATED';
      }
    }

    // ---------- PROBABILIDADE ----------
    let probability = 0;
    if (targetMaxPosition === 1) {
      if (targetPoints > maxRivalPotential) {
        probability = 100;
      } else if (targetPoints > leaderPoints) {
        const margem = targetPoints - leaderPoints;
        probability = Math.min(99, 80 + (margem * 2));
      } else {
        const leaders = sortedCurrentRanking.filter(r =>
          r.userId !== activeUserId &&
          compareBySportsRanking(r, sortedCurrentRanking[0], tieBreakers) === 0
        );
        if (leaders.length === 0) {
          const ameaca = maxRivalPotential - targetPoints;
          if (ameaca < 0) {
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
              const targetPick = targetPicksMap.get(midStr);
              const leaderPick = (leaderBet?.groupMatches || []).find(gm => String(gm.matchId) === midStr);

              if (targetPick && leaderPick) {
                // A disputa potencial entre dois palpites usa o teto real da
                // partida configurada pelo ADM. Isso cobre regras customizadas
                // (matchRules), regras legadas e o bônus de classificado, sem
                // reintroduzir valores fixos de exactScore/winner.
                contestedPoints += getMaxPointsPerMatch(scoringRules, champRules, m);
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

            const leaderGhostPoints = strategyGhostPointsByUser.get(leader.userId) || 0;
            contestedPoints += Math.max(targetGhostPoints, leaderGhostPoints);

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

      // Janela de perigo derivada do formato da partida, e não do nome fixo
      // da etapa. Em ida/volta o confronto pode envolver as duas pernas; em
      // jogo único/rodada simples uma partida basta para alterar o ranking.
      const dangerMatchWindow = isKnockoutPhase &&
        getEffectiveKnockoutFormat(champRules, m) === 'home_away'
        ? 2
        : 1;
      const meuPotencialMaximo = targetMaxTotal;
      const MARGEM_DE_PERIGO_PONTOS = dangerMatchWindow * getMaxPointsPerMatch(scoringRules, champRules, m);

      const rivalsToWatch = currentRanking.filter(r => {
        if (r.userId === activeUserId) return false;
        if (r.points > targetPoints) return true;

        const rivalPodium = userPodiumPotentialMap.get(r.userId) || 0;
        const rivalFutureNonMatch = strategyFutureNonMatchPotential.get(r.userId) || { total: 0, groupQualificationPoints: 0, extraPoints: 0 };
        const rivalCurrentGroupQualification = Number(r.groupQualificationPoints || 0);
        const rivalGroupPotential = structuralGroupQualificationMaximum > 0
          ? Math.min(Number(rivalFutureNonMatch.groupQualificationPoints || 0), Math.max(0, structuralGroupQualificationMaximum - rivalCurrentGroupQualification))
          : Number(rivalFutureNonMatch.groupQualificationPoints || 0);
        const rivalFutureNonMatchPotential = rivalGroupPotential + Number(rivalFutureNonMatch.extraPoints || 0);
        // getUserKnockoutFuturePotential já reúne ghost (materializado/aberto)
        // + potencial estrutural não materializado. Não adicionar nenhuma outra
        // fonte de KO aqui, pois este cálculo é usado apenas para identificar
        // rivais que ainda podem ameaçar o alvo nesta partida.
        const rivalKnockoutFuturePotential = getUserKnockoutFuturePotential(r.userId);
        const rivalRawPotential = r.points + rivalPodium + rivalFutureNonMatchPotential + rivalKnockoutFuturePotential + (strategyRoundRobinUnmaterializedPointsByUser.get(r.userId) || 0);
        const rivalPotencialMaximo = structuralChampionshipCeiling > 0
          ? Math.max(Number(r.points || 0), Math.min(structuralChampionshipCeiling, rivalRawPotential))
          : rivalRawPotential;

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
        stageFormat: m.stageFormat || null,
        knockoutFormat: getEffectiveKnockoutFormat(champRules, m),
        knockoutLeg: m.knockoutLeg ?? null,
        knockoutExpectedLegs: m.knockoutExpectedLegs ?? null,
        knockoutTieKey: m.knockoutTieKey || null,
        isFinalSingle: m.phase === 'knockout' && String(m.phaseName || m.group || '').trim().toLowerCase() === 'final' && getEffectiveKnockoutFormat(champRules, m) === 'single',
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
          unmaterializedRoundRobinMatches: (champRules?.hasGroupPhase === true
            ? getUnmaterializedRoundRobinMatchCount(getGroupStructure(champRules).expectedMatches, matches.filter(m => String(m.phase || '').trim().toLowerCase() === 'group'))
            : getUnmaterializedRoundRobinMatchCount(getPointsRunStructure(champRules).expectedMatches, matches.filter(m => ['pontos_corridos','points_run'].includes(String(m.phase || '').trim().toLowerCase())))),
          podiumDetails,
          miracleAchieved,
          miracleTotalMatchesNeeded,
          miracleCriticalMatches,
          simulatedRanking: simulatedRankingList,
          nemesis: null,
          prizeZonePositions: awardZonePositions,
          positionBoundsAreConservative: true,
          maxPositionIsProjection: true,
          guaranteedOutsidePrizeZonePosition
        },
        matches: matchesAnalysis
      }
    });
  } catch (e) {
    console.error('❌ ERRO CRÍTICO NO CAMINHO DA LIDERANÇA:', e);
    res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }}

module.exports = { getLeadershipPath };
