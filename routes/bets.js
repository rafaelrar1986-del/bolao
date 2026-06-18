const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings'); 
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

const router = express.Router();

/**
 * 🛠️ HELPERS
 */
const getConfigId = (leagueId) => {
  const id = leagueId || '1';
  return `league_${id}`;
};

function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  if (choice === 'draw') return 'Empate';
  return '-';
}




/**
 * 🧠 ESTRATÉGIA: Caminho da Liderança (VERSÃO DEFINITIVA SUPREMA - 2026)
 * Inclui: Mata-mata independente, Pódio Live, Secagem Dinâmica, Pênaltis, Cronologia Invertida e Botão do Milagre.
 * 🚀 NOVO: Otimização de Memória (Mongoose Select), Anti-ReDoS (Limite JSON) e Feature 'Nêmesis'.
 */

// =========================================================================
// 🛠️ FUNÇÕES AUXILIARES (HELPERS) - Podem ser extraídas para um arquivo de Service
// =========================================================================
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

        const configId = `league_${leagueId}`;
        const [settings, officialPodiumDoc, matches, bets] = await Promise.all([
            Settings.findById(configId).lean(),
            Settings.findOne({ key: 'podium', leagueId: lIdNum }).select('podium').lean(),
            Match.find({ leagueId: lIdNum })
                .select('matchId date time status scoreA scoreB penaltiesA penaltiesB phase teamA teamB logoA logoB group qualifiedSide')
                .lean(),
            Bet.find({ hasSubmitted: true, $or: [{ leagueId: lIdStr }, { leagueId: lIdNum }] })
                .select('user groupMatches.matchId groupMatches.winner groupMatches.qualifier podium podiumPoints')
                .populate('user', 'name')
                .lean()
        ]);

        if (mode === 'simulacao' && simulations && simulations.length < 50000) {
            try {
                const parsedSimulations = JSON.parse(simulations);
                matches.forEach(m => {
                    const midStr = String(m.matchId);
                    const simData = parsedSimulations[midStr];
                    if (simData && m.status !== 'finished') {
                        const winner = simData.winner?.toLowerCase();
                        const qualifier = simData.qualifier?.toUpperCase();

                        if (winner || qualifier) {
                            m.isSimulated = true;
                            if (winner === 'a') { m.scoreA = 2; m.scoreB = 0; }
                            else if (winner === 'b') { m.scoreA = 0; m.scoreB = 2; }
                            else if (winner === 'draw') { m.scoreA = 1; m.scoreB = 1; }

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
        const officialPodium = officialPodiumDoc?.podium || {};
        const betsByUserMap = new Map(bets.filter(b => b.user?._id).map(b => [b.user._id.toString(), b]));
        const matchMap = new Map(matches.map(m => [String(m.matchId), m]));
        const matchIdsDaLiga = new Set(matchMap.keys());
        const eliminatedTeams = new Set();

        const targetBet = betsByUserMap.get(activeUserId);
        if (!targetBet) return res.status(404).json({ success: false, message: 'Aposta não encontrada' });

        const targetPicksMap = new Map();
        (targetBet.groupMatches || []).forEach(gm => {
            if (matchIdsDaLiga.has(String(gm.matchId))) targetPicksMap.set(String(gm.matchId), gm);
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

        const currentRanking = bets
            .map(b => {
                const betUserId = b.user?._id?.toString();
                if (!betUserId) return null;

                let pts = 0;
                (b.groupMatches || []).forEach(gm => {
                    const midStr = String(gm.matchId);
                    const m = matchMap.get(midStr);
                    if (!m) return;

                    const isMatchValid = isLive ? (m.status !== 'scheduled' || m.isSimulated) : (m.status === 'finished' || m.isSimulated);
                    if (!isMatchValid) return;

                    const realWinner = getMatchResult(m.scoreA, m.scoreB);
                    const realQual = getQualifiedSide(m, realWinner);

                    if (realWinner && gm.winner === realWinner) pts += 1;
                    if (gm.qualifier && realQual && gm.qualifier === realQual) pts += 1;

                    const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
                    if (isKnockoutPhase && !['Semifinal', 'Final', '3º lugar'].includes(m.group)) {
                        if (m.status === 'finished' || m.isSimulated) {
                            const loser = realQual === 'A' ? m.teamB : (realQual === 'B' ? m.teamA : null);
                            if (loser) eliminatedTeams.add(loser);
                        } else if (isLive && liveStatuses.includes(m.status)) {
                            if (m.scoreA > m.scoreB) eliminatedTeams.add(m.teamB);
                            else if (m.scoreB > m.scoreA) eliminatedTeams.add(m.teamA);
                        }
                    }
                });

                return { userId: betUserId, points: pts + (b.podiumPoints || 0), name: b.user?.name || "" };
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

        const displayFutureMatches = matches
            .filter(m => (isLive ? m.status === 'scheduled' : m.status !== 'finished') || m.isSimulated)
            .sort((a, b) => (parseInt(String(b.matchId).replace(/\D/g, ''), 10) || 0) - (parseInt(String(a.matchId).replace(/\D/g, ''), 10) || 0));

        const mathFutureMatches = displayFutureMatches.filter(m => !m.isSimulated);

        const miracleSimulations = {};
        let miracleAchieved = false;
        let miracleCriticalMatches = 0;

        const getRankingSnapshot = (pointsMap) => {
            const list = Object.entries(pointsMap)
                .map(([userId, points]) => {
                    const bet = betsByUserMap.get(userId);
                    return {
                        userId,
                        points,
                        name: bet?.user?.name || ''
                    };
                })
                .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

            let posToAssign = 0;
            let lastPoints = null;

            const ranked = list.map((item, index) => {
                if (lastPoints === null || item.points !== lastPoints) {
                    posToAssign = index + 1;
                    lastPoints = item.points;
                }
                return {
                    ...item,
                    position: posToAssign
                };
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

        const getTopPoints = (pointsMap) => Math.max(...Object.values(pointsMap));
        const getGapToLeader = (pointsMap) => getTopPoints(pointsMap) - (pointsMap[activeUserId] || 0);

        if (isMiracleMode && activeUserId) {
            const placarDinamico = Object.fromEntries(currentRanking.map(u => [u.userId, u.points]));
            const isNoTopo = () => {
                const snapshot = getRankingSnapshot(placarDinamico);
                return snapshot.targetPosition === 1;
            };

            if (!isNoTopo()) {
                const jogosParaCalculo = [...mathFutureMatches].sort((a, b) => new Date(a.date) - new Date(b.date));

                for (const m of jogosParaCalculo) {
                    if (isNoTopo()) break;

                    const midStr = String(m.matchId);
                    const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
                    const targetPick = targetPicksMap.get(midStr);

                    if (!targetPick || (!targetPick.winner && !targetPick.qualifier)) continue;

                    const before = getRankingSnapshot(placarDinamico);

                    miracleSimulations[midStr] = {
                        winner: targetPick.winner || null,
                        qualifier: isKnockoutPhase ? (targetPick.qualifier || null) : null
                    };

                    Array.from(betsByUserMap.values()).forEach(bet => {
                        const rivalPick = (bet.groupMatches || []).find(gm => String(gm.matchId) === midStr);
                        const uId = bet.user._id.toString();

                        if (rivalPick) {
                            if (targetPick.winner && rivalPick.winner === targetPick.winner) {
                                placarDinamico[uId] = (placarDinamico[uId] || 0) + 1;
                            }
                            if (isKnockoutPhase && targetPick.qualifier && rivalPick.qualifier === targetPick.qualifier) {
                                placarDinamico[uId] = (placarDinamico[uId] || 0) + 1;
                            }
                        }
                    });

                    const after = getRankingSnapshot(placarDinamico);

                    const changedLeader = before.leaderId !== after.leaderId;
                    const improvedTargetPosition = after.targetPosition < before.targetPosition;
                    const reducedGap = after.gapToLeader < before.gapToLeader;

                    if (changedLeader || improvedTargetPosition || reducedGap) {
                        miracleCriticalMatches++;
                      // ADICIONE ESTA LINHA ABAIXO PARA SINALIZAR A PARTIDA:
                      miracleSimulations[midStr].isCritical = true;
                    }
                }
            }

            miracleAchieved = isNoTopo();
        }

        const podiumWeights = { first: 7, second: 5, third: 4, fourth: 3 };
        const userPodiumPotentialMap = new Map();

        bets.forEach(b => {
            const betUserId = b.user?._id?.toString();
            if (!betUserId) return;
            let pot = 0;
            if (b.podium) {
                ['first', 'second', 'third', 'fourth'].forEach(pos => {
                    if (!officialPodium[pos] && b.podium[pos] && !eliminatedTeams.has(b.podium[pos])) pot += podiumWeights[pos];
                });
            }
            userPodiumPotentialMap.set(betUserId, pot);
        });

        const targetPodiumPotential = userPodiumPotentialMap.get(activeUserId) || 0;
        const isPodiumLocked = !isAdmin && !unlockedPhases.includes('podium') && !unlockedPhases.includes('Pódio');
        const hidePodium = !isViewingSelf && isPodiumLocked;
        const podiumDetails = [];

        if (targetBet.podium) {
            ['first', 'second', 'third', 'fourth'].forEach(key => {
                if (hidePodium) {
                    podiumDetails.push({ team: 'Conteúdo Bloqueado 🔒', position: key, points: podiumWeights[key], status: 'locked' });
                    return;
                }
                const teamName = targetBet.podium[key];
                if (teamName) {
                    let status = officialPodium[key] === teamName ? 'conquered' : (officialPodium[key] || eliminatedTeams.has(teamName) ? 'dead' : 'alive');
                    const matchRef = matches.find(m => m.teamA === teamName || m.teamB === teamName);
                    const logoUrl = matchRef ? (matchRef.teamA === teamName ? matchRef.logoA : matchRef.logoB) : null;
                    podiumDetails.push({ team: teamName, logoUrl, position: key, points: podiumWeights[key], status });
                }
            });
        }

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
                    if (targetPick?.winner) projPts += 1;
                    if (isKnockoutPhase && targetPick?.qualifier) projPts += 1;
                } else if (targetPick && rivalPick) {
                    if (targetPick.winner && targetPick.winner === rivalPick.winner) projPts += 1;
                    if (isKnockoutPhase && targetPick.qualifier && targetPick.qualifier === rivalPick.qualifier) projPts += 1;
                }
            });

            if (isTarget) projPts += targetPodiumPotential;
            return { userId: r.userId, totalPoints: projPts, name: r.name };
        });

        projectedRanking.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));

        const targetUserProj = projectedRanking.find(r => r.userId === activeUserId);
        const usersBetter = projectedRanking.filter(r => r.totalPoints > (targetUserProj?.totalPoints ?? 0)).length;
        const targetMaxPosition = usersBetter + 1;

        const matchPointsLeft = mathFutureMatches.reduce((acc, m) => {
            const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
            const targetPick = targetPicksMap.get(String(m.matchId));
            let pts = 0;
            if (targetPick?.winner) pts += 1;
            if (isKnockoutPhase && targetPick?.qualifier) pts += 1;
            return acc + pts;
        }, 0);

        const totalPotential = matchPointsLeft + targetPodiumPotential;
        const targetMaxTotal = targetPoints + totalPotential;

        let probability = 0;

        if (targetMaxPosition === 1) {
            if (targetPoints > leaderPoints) {
                const margem = targetPoints - leaderPoints;
                probability = Math.min(99, 80 + (margem * 2));
            } else {
                const leaders = sortedCurrentRanking.filter(r => r.points === leaderPoints && r.userId !== activeUserId);

                if (leaders.length === 0) {
                    probability = 80;
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

                            if (targetPick) {
                                if (targetPick.winner !== leaderPick?.winner) {
                                    contestedPoints += 1;
                                }
                                if (isKnockout && targetPick.qualifier !== leaderPick?.qualifier) {
                                    contestedPoints += 1;
                                }
                            }
                        });

                        if (targetBet.podium) {
                            ['first', 'second', 'third', 'fourth'].forEach(pos => {
                                const myTeam = targetBet.podium[pos];
                                const leaderTeam = leaderBet?.podium?.[pos];
                                if (myTeam && !eliminatedTeams.has(myTeam) && myTeam !== leaderTeam) {
                                    contestedPoints += podiumWeights[pos];
                                }
                            });
                        }

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

                    probability = Math.max(1, Math.round(minChanceAgainstLeaders));
                }
            }
        }

        const matchesAnalysis = displayFutureMatches.map((m, index) => {
            const midStr = String(m.matchId);
            const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
            const isLocked = !isAdmin && (m.phase === 'group' ? !unlockedPhases.includes('group') : !unlockedPhases.includes(m.group));
            const targetPick = targetPicksMap.get(midStr);

            if (index < 2) console.log(`5. ANALISANDO JOGO ${midStr}:`, targetPick ? '✅ ENCONTRADO' : '❌ SEM PALPITE');

            let rivalsToWatch = currentRanking.filter(r => r.userId !== activeUserId && r.points > targetPoints);

            if (rivalsToWatch.length === 0) {
                let MARGEM_DE_PERIGO = 3;
                if (m.phase === 'group') {
                    MARGEM_DE_PERIGO = 4;
                } else if (isKnockoutPhase) {
                    switch (m.group) {
                        case '16-avos de final': MARGEM_DE_PERIGO = 6; break;
                        case 'Oitavas de final': MARGEM_DE_PERIGO = 4; break;
                        case 'Quartas de final': MARGEM_DE_PERIGO = 3; break;
                        case 'Semifinal':
                        case '3º lugar':
                        case 'Final': MARGEM_DE_PERIGO = 2; break;
                    }
                }

                const meuPotencialMaximo = targetPoints + targetPodiumPotential;

                rivalsToWatch = currentRanking.filter(r => {
                    if (r.userId === activeUserId) return false;

                    const rivalPodium = userPodiumPotentialMap.get(r.userId) || 0;
                    const rivalPotencialMaximo = r.points + rivalPodium;

                    return rivalPotencialMaximo >= (meuPotencialMaximo - MARGEM_DE_PERIGO);
                });
            }

            const opponentsToWatch = isLocked ? ["Conteúdo Bloqueado 🔒"] : rivalsToWatch.filter(ra => {
                const rb = betsByUserMap.get(ra.userId);
                const rp = (rb?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
                return rp && (rp.winner !== targetPick?.winner || (isKnockoutPhase && rp.qualifier !== targetPick?.qualifier));
            }).map(ra => betsByUserMap.get(ra.userId)?.user?.name).filter(Boolean);

            const hideTargetPick = isLocked && !isViewingSelf;

            const miracleData = miracleSimulations[midStr] || null;
            const isMiracleResult = !!miracleData;
            const miracleChoice = miracleData ? miracleData.winner : null;
            const miracleQualifier = miracleData ? miracleData.qualifier : null;

            const isSimulationMode = mode === 'simulacao' || isMiracleMode;
            const hasImpact = isSimulationMode ? true : (m.isSimulated === true || isMiracleResult === true || opponentsToWatch.length > 0);

            return {
                matchId: m.matchId,
                date: m.date, // 🟢 ADICIONE ESTA LINHA
                time: m.time, // 🟢 ADICIONE ESTA LINHA
                teams: `${m.teamA} x ${m.teamB}`,
                status: m.status,
                phase: m.phase,
                group: m.group,
                hasImpact,
                isMiracleResult,
               isCriticalForMiracle: miracleData ? !!miracleData.isCritical : false,
                miracleChoice,
                miracleQualifier,
                isLocked,
                myChoice: hideTargetPick ? {
                    winner: null,
                    label: 'Conteúdo Bloqueado 🔒',
                    qualifier: null,
                    qualifierName: null
                } : {
                    winner: targetPick?.winner || null,
                    label: toWinnerLabel(targetPick?.winner, m.teamA, m.teamB),
                    qualifier: targetPick?.qualifier || null,
                    qualifierName: targetPick?.qualifier === 'A' ? m.teamA : (targetPick?.qualifier === 'B' ? m.teamB : (isKnockoutPhase ? 'Sem Palpite' : null))
                },
                opponentsToWatch
            };
        });

        const miracleTotalMatchesNeeded = Object.keys(miracleSimulations).length;

        console.log(`DEBUG MILAGRE: Total Needed: ${miracleTotalMatchesNeeded}, Critical: ${miracleCriticalMatches}`);

        res.json({
            success: true,
            data: {
                summary: {
                    currentPosition,
                    maxPosition: targetMaxPosition,
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
//🎯 Meus palpites (Filtrado por Liga)
 
router.get('/my-bets', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é obrigatório' });
    }

    // Convertemos para Number e String para garantir compatibilidade
    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);

    const [bet, matches] = await Promise.all([
      // AQUI ESTAVA O ERRO: Adicionamos o leagueId na busca da aposta
      Bet.findOne({ 
        user: req.user._id, 
        leagueId: lIdStr 
      }).lean(),
      
      Match.find({ leagueId: lIdNum }).lean()
    ]);

    // Se não encontrou aposta para ESTA LIGA específica
    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
    }

    // Criamos um Set de IDs de partidas da liga atual (para performance e comparação segura)
    const matchIdsDaLiga = new Set(matches.map(m => Number(m.matchId)));

    // Filtramos os palpites que pertencem APENAS a esta liga
    const gm = (bet.groupMatches || [])
      .filter(b => matchIdsDaLiga.has(Number(b.matchId))) // Comparação Number vs Number
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

    // O status de submissão agora é real por liga
    return res.json({
      success: true,
      data: { ...bet, groupMatches: gm },
      hasSubmitted: gm.length > 0
    });

  } catch (e) {
    console.error('GET /my-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
});


/**
/* =========================================================================
   💾 Salvar palpites (ATUALIZADO, CORRIGIDO E ORDENADO POR GRUPO NO EMAIL)
   ========================================================================= */
router.post('/save', protect, checkPaid, async (req, res) => {
  try {
    const { groupMatches, podium, knockoutQualifiers, leagueId } = req.body;
    
    // 1. Validação crítica do leagueId
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    }

    const configId = `league_${leagueId}`;
    const Settings = require('../models/Settings'); 
    const Match = require('../models/Match');
    const Bet = require('../models/Bet');
    const User = require('../models/User');
    const { sendBetsConfirmationEmail } = require('../services/emailService');

    const settings = await Settings.findById(configId).lean();

    const matchIdsEnviados = Object.keys(groupMatches || {}).map(Number);
    
    // 2. Busca as partidas no banco de dados
    const dbMatches = await Match.find({ 
      matchId: { $in: matchIdsEnviados }, 
      leagueId: Number(leagueId) 
    }).select('matchId group phaseName teamA teamB logoA logoB').lean();

    const validMatchIds = new Set(dbMatches.map(m => m.matchId));

   // ============================================================
    // 🛡️ VALIDAÇÃO DE GRADE TRANCADA (Suporte Inteligente a Grupos e Mata-Mata)
    // ============================================================
    if (settings && settings.lockedPhases && settings.lockedPhases.length > 0) {
      // 1. Puxa os palpites antigos que o usuário já tinha guardados no banco de dados antes
      const existing = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) }).lean();
      const palpitesAntigosMap = new Map();
      if (existing && Array.isArray(existing.groupMatches)) {
        existing.groupMatches.forEach(b => palpitesAntigosMap.set(Number(b.matchId), b));
      }

      for (const matchId of matchIdsEnviados) {
        const idNum = Number(matchId); // Garante a chave comparativa sempre como Number
        const matchData = dbMatches.find(m => Number(m.matchId) === idNum);
        
        if (matchData) {
          const gradeDaPartida = matchData.phaseName || matchData.group;
          
          if (settings.lockedPhases.includes(gradeDaPartida)) {
            // Palpites extraídos do payload vindo do Front-end nesta requisição
            const palpiteEnviado = groupMatches[matchId] || groupMatches[String(matchId)];
            const classificadoEnviado = knockoutQualifiers ? (knockoutQualifiers[matchId] || knockoutQualifiers[String(matchId)]) : null;

            // Dados correspondentes recuperados do histórico do banco
            const dadosAntigos = palpitesAntigosMap.get(idNum);
            const palpiteJaSalvo = dadosAntigos ? dadosAntigos.winner : null;
            const classificadoJaSalvo = dadosAntigos ? dadosAntigos.qualifier : null;

            // 💡 CRITÉRIO DE LIBERAÇÃO (BYPASS):
            // Se o palpite do jogo E a escolha de classificação forem EXATAMENTE idênticos
            // ao que já estava na base de dados, ignoramos o bloqueio porque não houve alteração.
            const naoAlterouVencedor = palpiteEnviado === palpiteJaSalvo;
            const naoAlterouClassificado = String(classificadoEnviado || '') === String(classificadoJaSalvo || '');

            if (naoAlterouVencedor && naoAlterouClassificado) {
              continue; // Pula esta iteração com segurança, o usuário não mexeu neste jogo trancado!
            }

            // Se o fluxo chegar aqui, significa que o usuário tentou de fato modificar um jogo trancado
            return res.status(403).json({ 
              success: false, 
              message: `As apostas para a grade "${gradeDaPartida}" já foram encerradas!` 
            });
          }
        }
      }
    }
    // ============================================================
    // 3. Busca a aposta ESPECÍFICA desta liga para manter o histórico
    const existing = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) });
    const gmMap = new Map();

    if (existing && Array.isArray(existing.groupMatches)) {
      existing.groupMatches.forEach((b) => gmMap.set(b.matchId, b));
    }

    // 4. Atualiza apenas palpites válidos
    Object.entries(groupMatches || {}).forEach(([matchId, choice]) => {
      const idNum = Number(matchId);
      if (!validMatchIds.has(idNum)) return; 
      if (!['A', 'B', 'draw'].includes(choice)) return;

      let qualifier = null;
      if (knockoutQualifiers && knockoutQualifiers[matchId]) {
        const q = knockoutQualifiers[matchId];
        if (q === 'A' || q === 'B') qualifier = q;
      }

      gmMap.set(idNum, {
        matchId: idNum,
        winner: choice,
        points: gmMap.get(idNum)?.points || 0,
        qualifier,
        qualifierPoints: gmMap.get(idNum)?.qualifierPoints || 0
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
      firstSubmission: existing?.firstSubmission || now,
    };

    // 5. Trata o pódio
    if (podium && podium.first) {
      payload.podium = {
        first: String(podium.first).trim(),
        second: String(podium.second).trim(),
        third: String(podium.third).trim(),
        fourth: podium.fourth ? String(podium.fourth).trim() : ''
      };
    }

    // 6. Atualiza ou Cria a Aposta
    const bet = await Bet.findOneAndUpdate(
      { user: req.user._id, leagueId: String(leagueId) },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    // Vínculo do usuário com a liga
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { leagues: Number(leagueId) }
    });

    // ============================================================
    // 📧 GERAÇÃO E ENVIO DO COMPROVANTE POR E-MAIL (BREVO API)
    // ============================================================
    try {
      const userEmail = req.user.email;
      const userName = req.user.name || 'Participante';
      const leagueName = settings?.title || `Liga #${leagueId}`;

      // 🌟 NOVA LÓGICA DE ORDENAÇÃO:
      // Vamos criar uma lista nova que junta o palpite do usuário com os dados reais do jogo.
      // Isso nos permite ordenar por "phaseName" ou por "group" antes de desenhar a tabela.
      const palpitesCompletos = [];

      listaFinalGrupoMatches.forEach((userBet) => {
        const matchInfo = dbMatches.find(m => Number(m.matchId) === Number(userBet.matchId));
        if (matchInfo && matchInfo.teamA && matchInfo.teamB) {
          palpitesCompletos.push({
            ...userBet,
            gameData: matchInfo
          });
        }
      });

      // Ordena por fase/rodada e depois por grupo alfabeticamente
      palpitesCompletos.sort((a, b) => {
        const gradeA = a.gameData.phaseName || a.gameData.group || '';
        const gradeB = b.gameData.phaseName || b.gameData.group || '';
        return gradeA.localeCompare(gradeB, undefined, { numeric: true, sensitivity: 'base' });
      });

      let betsHtml = `
        <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f4f6f7; border-bottom: 2px solid #bdc3c7;">
              <th style="padding: 12px; text-align: left; color: #34495e;">Confronto / Grupo</th>
              <th style="padding: 12px; text-align: center; color: #34495e; width: 160px;">Seu Palpite</th>
            </tr>
          </thead>
          <tbody>
      `;

      let ultimaGrade = '';

      // Varre a lista que já está perfeitamente ordenada por grupo/rodada
      palpitesCompletos.forEach((item) => {
        const matchInfo = item.gameData;
        const gradeAtual = matchInfo.phaseName || matchInfo.group || 'Geral';

        // Cria uma linha divisória visual cinza toda vez que mudar de grupo/rodada
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

      // Bloco do pódio
      if (payload.podium && payload.podium.first) {
        betsHtml += `
          <div style="margin-top: 25px; padding: 15px; background-color: #fcf8e3; border: 1px solid #faebcc; border-radius: 4px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #8a6d3b;">🏆 Seus Palpites de Pódio:</h4>
            <p style="margin: 4px 0;"><strong>1º Lugar:</strong> ${payload.podium.first}</p>
            <p style="margin: 4px 0;"><strong>2º Lugar:</strong> ${payload.podium.second}</p>
            <p style="margin: 4px 0;"><strong>3º Lugar:</strong> ${payload.podium.third}</p>
            ${payload.podium.fourth ? `<p style="margin: 4px 0;"><strong>4º Lugar:</strong> ${payload.podium.fourth}</p>` : ''}
          </div>
        `;
      }

      sendBetsConfirmationEmail(userEmail, userName, leagueName, betsHtml)
        .catch(err => console.error('❌ Falha assíncrona ao enviar e-mail de palpites:', err.message));

    } catch (emailSetupError) {
      console.error('❌ Erro na preparação do e-mail de palpites:', emailSetupError);
    }
    // ============================================================

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
/**
 * 🏆 Leaderboard (Filtrado por LIGA)
 * Totalmente alinhado com ranking.js
 */
router.get('/leaderboard', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    // Captura os parâmetros exatamente como o seu frontend envia
    const { leagueId, type } = req.query; 
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    
    // Define se é parcial baseado no que o ranking.js enviou
    const isPartialRequest = type === 'partial';

    const [matches, bets] = await Promise.all([
      Match.find({ leagueId: lIdNum }).select('matchId status scoreA scoreB phase qualifiedSide').lean(),
      Bet.find({ 
        hasSubmitted: true, 
        leagueId: lIdStr 
      }).populate('user', 'name avatar').lean()
    ]);

    const matchMap = new Map(matches.map(m => [Number(m.matchId), m]));
    const matchIdsDaLiga = new Set(matches.map(m => Number(m.matchId)));

    const getWinner = (a, b) => {
      if (a === undefined || b === undefined || a === null || b === null) return null;
      if (a > b) return 'A';
      if (b > a) return 'B';
      return 'draw';
    };

    const ranked = bets.map((b) => {
      let totalPoints = 0;
      let groupPhasePoints = 0;
      let knockoutPoints = 0;

      const userBetsDaLiga = (b.groupMatches || []).filter(gm => matchIdsDaLiga.has(Number(gm.matchId)));

      userBetsDaLiga.forEach(gm => {
        const m = matchMap.get(Number(gm.matchId));
        if (!m) return;

        // --- LÓGICA DE FILTRAGEM POR TIPO ---
        if (isPartialRequest) {
          // No modo PARCIAL: Ignora apenas o que ainda não começou (scheduled)
          if (m.status === 'scheduled') return;
        } else {
          // No modo OFICIAL: Ignora tudo que não está FINALIZADO
          if (m.status !== 'finished') return;
        }
        // ------------------------------------

        const realWinner = getWinner(m.scoreA, m.scoreB);
        
        // 1. Ponto por acertar o vencedor/empate
        if (realWinner && gm.winner === realWinner) {
          totalPoints += 1;
          if (m.phase === 'group') groupPhasePoints += 1;
          else knockoutPoints += 1;
        }

        // 2. Ponto por acertar quem classifica (Mata-mata)
        const realQual = m.qualifiedSide || (realWinner !== 'draw' ? realWinner : null);
        if (gm.qualifier && realQual && gm.qualifier === realQual) {
          totalPoints += 1;
          knockoutPoints += 1;
        }
      });

      const podiumPoints = b.podiumPoints || 0;
      const bonusPoints = b.bonusPoints || 0;
      const finalTotalPoints = totalPoints + podiumPoints + bonusPoints;

      return {
        user: b.user,
        totalPoints: finalTotalPoints, // O frontend usa este campo para os pontos
        groupPhasePoints,
        knockoutPoints,
        podiumPoints, // Mantido para o card de detalhes do mobile
        bonusPoints,
        lastUpdate: b.lastUpdate
      };
    });

    // Ordenação: Pontos Descendente -> Nome Ascendente
    ranked.sort((a, b) => b.totalPoints - a.totalPoints || (a.user?.name || "").localeCompare(b.user?.name || ""));

    // Atribuição de posições
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

// 👁️ Todos os palpites (Com trava de visibilidade por liga)
router.get('/all-bets', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { search, matchId, group, leagueId } = req.query;
    const isAdmin = req.user?.isAdmin === true;

    // 1. Busca configurações específicas da liga para saber o que desbloquear
    const configId = getConfigId(leagueId);
    const settings = await Settings.findById(configId).lean();
    const unlockedPhases = settings?.unlockedPhases || [];
    
    let matchFilter = {};
    if (leagueId) matchFilter.leagueId = Number(leagueId);
    
    // ✨ CORREÇÃO CRÍTICA: Se vier um "group" na query (ex: Rodada 6), 
    // buscamos tanto no campo 'group' quanto no 'phaseName'.
    if (group) {
      matchFilter.$or = [
        { group: { $regex: group, $options: 'i' } },
        { phaseName: { $regex: group, $options: 'i' } }
      ];
    }
    
    if (matchId) matchFilter.matchId = Number(matchId);

    const matches = await Match.find(matchFilter).lean();
    const matchIdsFilter = matches.map(m => m.matchId);

    // Se não achar partidas para esse filtro, já retornamos vazio para evitar erros
    if (matchIdsFilter.length === 0) {
      return res.json({ success: true, data: [] });
    }

    let query = { hasSubmitted: true };
    if (search) {
      const users = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id').lean();
      query.user = { $in: users.map(u => u._id) };
    }
    
    // Garantimos que o leagueId na busca das Bets também seja filtrado (se fornecido)
    if (leagueId) {
      query.$or = [
        { leagueId: String(leagueId) },
        { leagueId: Number(leagueId) }
      ];
    }

    query['groupMatches.matchId'] = { $in: matchIdsFilter };

    // Buscamos as apostas (incluindo o campo podium)
    const bets = await Bet.find(query).populate('user', 'name').lean();

    const enriched = bets.map(b => {
      // Filtramos apenas os palpites que pertencem aos jogos da rodada/grupo atual
      const gm = (b.groupMatches || []).filter(x => matchIdsFilter.includes(x.matchId));

      const viewBets = gm.map(g => {
        const m = matches.find(x => x.matchId === g.matchId);
        
        let isLocked = !isAdmin;

        if (m?.phase === 'group' || m?.phase === 'pontos_corridos') {
            // Lógica Híbrida: Liberta se tiver a chave mestra 'group' OU a rodada específica OU o phaseName
            const groupUnlocked = unlockedPhases.includes('group');
            const specificGroupUnlocked = unlockedPhases.includes(m?.group);
            const phaseNameUnlocked = unlockedPhases.includes(m?.phaseName);

            isLocked = !isAdmin && !groupUnlocked && !specificGroupUnlocked && !phaseNameUnlocked;
        } else {
            // Mata-mata (oitavas, etc)
            isLocked = !isAdmin && !unlockedPhases.includes(m?.group);
        }

        return {
          matchId: g.matchId,
          choice: isLocked ? '🔒' : g.winner,
          choiceLabel: isLocked ? 'Bloqueado' : toWinnerLabel(g.winner, m?.teamA, m?.teamB),
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${g.matchId}`,
          status: m?.status || 'scheduled',
          qualifier: isLocked ? null : g.qualifier
        };
      });

      // 🎯 CONTROLE DO PÓDIO
      const isPodiumLocked = !isAdmin && !unlockedPhases.includes('podium');
      const finalPodium = (b.podium && !isPodiumLocked) ? b.podium : (b.podium ? { first: '🔒', second: '🔒', third: '🔒', fourth: '🔒' } : null);

      return {
        userName: b.user?.name || 'Usuário',
        totalPoints: b.totalPoints || 0,
        bets: viewBets,
        podium: finalPodium
      };
    });

    res.json({ success: true, data: enriched });
  } catch (e) {
    console.error('All-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar apostas' });
  }
});
/**
 * 🔍 Partidas para filtro (Filtrado por Liga)
 */
router.get('/matches-for-filter', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    let filter = {};
    if (leagueId) filter.leagueId = Number(leagueId);

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
/**
 * ⚠️ Admin: Reset Total (Bets, Histórico e Vínculos)
 * Atualizado para garantir que nenhum rastro de pontuação antiga permaneça.
 */
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'Informe o leagueId para resetar' });
    }

    const lidStr = String(leagueId);
    const lidNum = Number(leagueId);

    // Importar os modelos necessários
    const User = require('../models/User');
    const Bet = require('../models/Bet');
    const PointsHistory = require('../models/PointsHistory'); // Verifique se o nome do arquivo/model está correto

    // 1. Deleta permanentemente os documentos de aposta desta liga
    const deleteBets = await Bet.deleteMany({ leagueId: lidStr });

    // 2. Deleta o histórico de pontos/evolução desta liga (O que faltava)
    const deleteHistory = await PointsHistory.deleteMany({ leagueId: lidStr });

    // 3. Remove o ID da liga do array 'leagues' de todos os usuários
    // Isso evita que o front-end carregue dados inexistentes para o usuário
    const userUpdate = await User.updateMany(
      { leagues: lidNum }, 
      { $pull: { leagues: lidNum } }
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
});/**
 * 👥 Usuários para filtro (Filtrado por LeagueId)
 */
router.get('/users-for-filter', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({ 
        success: false, 
        message: 'O parâmeto leagueId é obrigatório para filtrar os usuários.' 
      });
    }

    // Filtramos os usuários que possuem o leagueId na sua lista de ligas/participações
    // O ajuste abaixo depende de como você estruturou o vínculo Usuário <-> Liga
    const query = { leagues: leagueId }; // Exemplo: se o usuário tem um array de IDs de ligas

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

// 🔐 PERMISSÃO PARA MENU "MORE"
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
