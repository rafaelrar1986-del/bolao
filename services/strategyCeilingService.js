'use strict';

const { getEffectiveKnockoutFormat } = require('../utils/knockoutFormat');
const { getKnockoutConfrontationKey } = require('../utils/knockoutConfrontationKey');
const { sanitizeGroupQualificationRules, getMaxPointsPerMatch, calculateMatchPoints, sanitizeChampionshipRules } = require('./pointsService');
const { getRoundRobinExpectedMatchCount } = require('./championshipStructureService');
const { KNOCKOUT_STAGE_NAMES, normalizeKnockoutStageName } = require('../utils/knockoutStageNames');



/**
 * Máximo que um palpite JÁ CONGELADO ainda pode receber.
 *
 * Quando a aposta está bloqueada, não é válido devolver simplesmente o teto
 * estrutural da partida: o placar/vencedor/classificado salvo pelo usuário
 * já está fixado. Procuramos o melhor resultado real compatível com as regras
 * configuradas pelo ADM. A grade de candidatos contém uma faixa normal de
 * placares e, adicionalmente, os valores derivados do próprio palpite, o que
 * cobre condições dinâmicas como totalGoals/goalDifference sem impor a regra
 * do Milagre (7x7) à Estratégia.
 */
function calculateFixedPickMaximum(pick, match, scoringRules = {}, champRules = {}) {
  if (!pick || !match) return 0;

  const scoreA = Number(pick.scoreA);
  const scoreB = Number(pick.scoreB);
  const validScore = Number.isFinite(scoreA) && scoreA >= 0 &&
    Number.isFinite(scoreB) && scoreB >= 0;

  // Um palpite bloqueado é fixo. Não devemos variar o placar apostado para
  // "procurar" uma pontuação maior: isso transforma o teto em algo que o
  // usuário nunca poderá alcançar. O único grau de liberdade relevante é o
  // desempate do mata-mata (prorrogação/pênaltis) quando o classificado foi
  // apostado separadamente.
  if (!validScore) {
    // Placar inválido não pode ganhar exactScore, mas, se o palpite possui
    // um vencedor explícito e winnerFromScore está desligado, esse vencedor
    // continua sendo uma previsão válida. Simulamos o menor placar coerente
    // com ela para preservar somente as condições realmente alcançáveis.
    const predictedWinner = pick.winner === 'A' || pick.winner === 'B' || pick.winner === 'draw'
      ? pick.winner
      : 'draw';
    const simulated = {
      ...match,
      status: 'finished',
      isSimulated: true,
      scoreA: predictedWinner === 'A' ? 1 : 0,
      scoreB: predictedWinner === 'B' ? 1 : 0,
      regularTimeScoreA: predictedWinner === 'A' ? 1 : 0,
      regularTimeScoreB: predictedWinner === 'B' ? 1 : 0
    };
    if (pick.qualifier === 'A' || pick.qualifier === 'B') {
      simulated.qualifiedSide = pick.qualifier;
      simulated.scenarioConfrontationQualifier = true;
    }
    return Math.max(0, Number(calculateMatchPoints(pick, simulated, scoringRules, champRules)?.points || 0));
  }

  const simulated = {
    ...match,
    status: 'finished',
    isSimulated: true,
    // O placar apostado representa a referência do palpite. Quando a liga
    // exclui prorrogação do resultado pontuável, ele é o placar dos 90';
    // quando inclui, ele é o placar final.
    scoreA,
    scoreB,
    regularTimeScoreA: scoreA,
    regularTimeScoreB: scoreB
  };

  const isKnockout = match?.phase === 'knockout' || match?.phase === 'mata-mata';
  if (isKnockout && (pick.qualifier === 'A' || pick.qualifier === 'B')) {
    // Em empate, o classificado pode ser definido por prorrogação/pênaltis.
    // Para o teto do palpite, podemos representar esse desempate diretamente
    // sem alterar o placar usado pela regra drawIncludesExtraTime.
    simulated.qualifiedSide = pick.qualifier;
    simulated.scenarioConfrontationQualifier = true;
  }

  return Math.max(0, Number(calculateMatchPoints(pick, simulated, scoringRules, champRules)?.points || 0));
}

function calculateStructuralGroupQualificationMaximum(scoringRules, champRules) {
  if (champRules?.hasGroupPhase !== true || champRules?.hasKnockoutPhase !== true) return 0;
  const cfg = champRules?.groupQualification || {};
  const totalTeams = Math.floor(Number(cfg.totalTeams) || 0);
  const groupCount = Math.floor(Number(cfg.groupCount) || 0);
  const totalQualified = Math.floor(Number(cfg.totalQualified) || 0);
  if (!totalTeams || !groupCount || !totalQualified || totalTeams % groupCount !== 0 || totalQualified > totalTeams) return 0;
  const rules = sanitizeGroupQualificationRules(scoringRules?.groupQualificationRules);
  if (!rules.length) return 0;

  const ruleMaxForStatus = (qualified) => {
    let best = 0;
    for (const rule of rules) {
      const c = rule.conditions || [];
      const requiresQualified = c.includes('teamQualified');
      const requiresNotQualified = c.includes('teamNotQualified');
      if (requiresQualified && !qualified) continue;
      if (requiresNotQualified && qualified) continue;
      // Position conditions can be made true by an appropriate future ranking;
      // positionCorrect and positionIncorrect are both possible at the structural
      // ceiling, so they do not change this upper bound.
      best = Math.max(best, Number(rule.points) || 0);
    }
    return best;
  };

  const qMax = ruleMaxForStatus(true);
  const nMax = ruleMaxForStatus(false);
  return Math.max(0, totalQualified * qMax + (totalTeams - totalQualified) * nMax);
}

function getKnockoutStagePlan(totalQualified, hasThirdPlaceMatch) {
  const q = Number(totalQualified);
  // O criador de partidas suporta no máximo 32 classificados para esta
  // estrutura. Não inventamos nomes para etapas acima disso.
  if (!Number.isInteger(q) || q < 2 || q > 32 || !Number.isInteger(Math.log2(q))) return [];

  const plan = [];
  let ties = q / 2;
  const stageByTies = new Map([
    [16, KNOCKOUT_STAGE_NAMES.ROUND_32],
    [8, KNOCKOUT_STAGE_NAMES.ROUND_16],
    [4, KNOCKOUT_STAGE_NAMES.QUARTERFINALS],
    [2, KNOCKOUT_STAGE_NAMES.SEMIFINAL],
    [1, KNOCKOUT_STAGE_NAMES.FINAL]
  ]);

  while (ties >= 1) {
    const stage = stageByTies.get(ties);
    if (!stage) return [];
    plan.push({ stage, ties });
    ties /= 2;
  }
  if (hasThirdPlaceMatch) plan.push({ stage: KNOCKOUT_STAGE_NAMES.THIRD_PLACE, ties: 1, thirdPlace: true });
  return plan;
}

function calculateStructuralKnockoutFuturePotential(matches, scoringRules, champRules) {
  if (champRules?.hasKnockoutPhase !== true) return 0;
  const q = Math.floor(Number(champRules?.groupQualification?.totalQualified || 0));
  const plan = getKnockoutStagePlan(q, champRules?.hasThirdPlaceMatch === true);
  if (!plan.length) return 0;

  const baseRules = { ...scoringRules, matchExtras: { ...(scoringRules?.matchExtras || {}), qualifier: 0 } };
  const stageByName = new Map(plan.map(item => [item.stage, item]));
  const materializedByStage = new Map();
  const isKO = m => m?.phase === 'knockout' || m?.phase === 'mata-mata';
  const getKey = m => m?.knockoutTieKey || getKnockoutConfrontationKey(m) || `match::${m?.matchId}`;

  for (const m of (Array.isArray(matches) ? matches : [])) {
    if (!isKO(m)) continue;
    const stage = normalizeKnockoutStageName(m.group || m.phaseName || m.roundName);
    if (!stage || !stageByName.has(stage)) continue;
    const key = String(getKey(m));
    if (!materializedByStage.has(stage)) materializedByStage.set(stage, new Map());
    const byTie = materializedByStage.get(stage);
    const format = getEffectiveKnockoutFormat(champRules, m);
    const expectedLegs = format === 'home_away' ? 2 : 1;
    const entry = byTie.get(key) || { sample: m, expectedLegs, legs: new Map() };
    entry.expectedLegs = Math.max(entry.expectedLegs, Number(m.knockoutExpectedLegs) === 2 ? 2 : expectedLegs);
    const leg = Number(m.knockoutLeg);
    const legKey = Number.isFinite(leg) && leg > 0 ? leg : entry.legs.size + 1;
    entry.legs.set(legKey, m);
    byTie.set(key, entry);
  }

  let total = 0;
  const globalQualifier = Math.max(0, Number(scoringRules?.matchExtras?.qualifier) || 0);

  for (const item of plan) {
    const expectedLegs = item.stage === KNOCKOUT_STAGE_NAMES.FINAL
      ? (getEffectiveKnockoutFormat(champRules, { group: KNOCKOUT_STAGE_NAMES.FINAL, phase: 'knockout' }) === 'home_away' ? 2 : 1)
      : (champRules.knockoutFormat === 'home_away' ? 2 : 1);
    const ties = materializedByStage.get(item.stage) || new Map();
    const materializedTieCount = ties.size;
    const missingTies = Math.max(0, item.ties - materializedTieCount);
    const sampleForStage = [...ties.values()][0]?.sample || { phase: 'knockout', group: item.stage, stageFormat: expectedLegs === 2 ? 'home_away' : 'single' };
    const baseMax = getMaxPointsPerMatch(baseRules, champRules, sampleForStage);
    const tieMax = baseMax * expectedLegs + globalQualifier;
    total += missingTies * tieMax;

  }
  return Math.max(0, total);
}



/**
 * Teto estrutural absoluto do campeonato, independente de partidas já
 * materializadas ou da rodada atualmente liberada. Este valor representa
 * quantos pontos o campeonato pode distribuir no máximo segundo as regras
 * atuais do ADM. O controller usa este valor apenas como limite superior do
 * teto individual, evitando que fontes de potencial futuro sejam somadas duas
 * vezes ou ultrapassem a própria estrutura do campeonato.
 */
function calculateStructuralChampionshipCeiling(scoringRules = {}, champRules = {}) {
  const normalizedChampRules = sanitizeChampionshipRules(champRules);
  const hasGroup = normalizedChampRules?.hasGroupPhase === true;
  const hasKnockout = normalizedChampRules?.hasKnockoutPhase === true;
  let total = 0;

  if (hasGroup) {
    const group = normalizedChampRules?.groupQualification || {};
    const totalTeams = Math.floor(Number(group.totalTeams) || 0);
    const groupCount = Math.floor(Number(group.groupCount) || 0);
    const legs = Number(group.legs) === 2 ? 2 : 1;
    if (totalTeams >= 2 && groupCount >= 1 && totalTeams % groupCount === 0) {
      const teamsPerGroup = totalTeams / groupCount;
      const expected = getRoundRobinExpectedMatchCount(teamsPerGroup, legs) * groupCount;
      total += expected * getMaxPointsPerMatch(scoringRules, normalizedChampRules, { phase: 'group' });
    }
  } else if (!hasKnockout) {
    const pointsRun = normalizedChampRules?.pointsRun || {};
    const totalTeams = Math.floor(Number(pointsRun.totalTeams) || 0);
    const legs = Number(pointsRun.legs) === 2 ? 2 : 1;
    if (totalTeams >= 2) {
      total += getRoundRobinExpectedMatchCount(totalTeams, legs) *
        getMaxPointsPerMatch(scoringRules, normalizedChampRules, { phase: 'pontos_corridos' });
    }
  }

  if (hasGroup && hasKnockout) {
    total += calculateStructuralGroupQualificationMaximum(scoringRules, normalizedChampRules);
  }

  if (hasKnockout) {
    total += calculateStructuralKnockoutFuturePotential([], scoringRules, normalizedChampRules);
    // calculateStructuralKnockoutFuturePotential intentionally returns only
    // the stages that are absent from the materialized inventory. With an empty
    // inventory that is exactly the complete structural knockout ceiling.
  }

  const extraKeys = ['topScorer', 'bestAttack', 'worstDefense', 'upset'];
  total += extraKeys.reduce((sum, key) => sum + Math.max(0, Number(scoringRules?.[key]) || 0), 0);

  const podiumSize = Math.min(4, Math.max(0, Math.floor(Number(normalizedChampRules?.podiumSize) || 0)));
  const podium = Array.isArray(scoringRules?.podiumPoints) ? scoringRules.podiumPoints : [];
  for (let i = 0; i < podiumSize; i++) total += Math.max(0, Number(podium[i]) || 0);

  return Math.max(0, total);
}

module.exports = { calculateStructuralGroupQualificationMaximum, calculateStructuralKnockoutFuturePotential, calculateStructuralChampionshipCeiling, getKnockoutStagePlan, calculateFixedPickMaximum };
