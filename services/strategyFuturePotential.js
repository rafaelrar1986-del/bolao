'use strict';

/**
 * Calcula somente fontes de pontuação FUTURA que não são partidas:
 * - classificação dos grupos ainda não encerrados;
 * - extras cujo resultado oficial ainda não foi definido.
 *
 * `ghostPoints` é fornecido separadamente pelo controller porque depende do
 * inventário de partidas de mata-mata ainda não materializadas/bloqueadas.
 * Esta função nunca inclui pontos já persistidos/calculados.
 */
function getRulePointsForItem(rule, item) {
  if (!rule || !Array.isArray(rule.conditions)) return 0;
  const possible = rule.conditions.every(condition => {
    switch (condition) {
      case 'positionCorrect': return item.positionCorrectPossible === true;
      case 'positionIncorrect': return item.positionIncorrectPossible === true;
      case 'teamQualified': return item.predictedQualified === true && item.actualQualifiedPossible === true;
      case 'teamNotQualified': return item.predictedQualified === false && item.actualNotQualifiedPossible === true;
      default: return false;
    }
  });
  return possible ? Math.max(0, Number(rule.points) || 0) : 0;
}

/**
 * Teto futuro de classificação por grupo.
 *
 * Diferentemente da versão anterior, não atribuímos automaticamente a maior
 * regra a cada posição. O status de classificação é derivado da estrutura do
 * ADM: posições diretas são sempre classificadas e a posição adicional pode
 * representar apenas as vagas extras que realmente existem.
 *
 * A função continua sendo um teto: não simula uma tabela inteira, mas respeita
 * as restrições de vagas extras entre grupos e o que o próprio usuário marcou
 * em additionalQualifiedTeams.
 */
function calculateGroupPredictionMaximum(prediction, state, rules, qualificationConfig) {
  if (!prediction || !state || state.complete === true) return { maximum: 0, baseline: 0, optionalGain: 0 };

  const totalTeams = Math.floor(Number(qualificationConfig?.totalTeams) || 0);
  const groupCount = Math.floor(Number(qualificationConfig?.groupCount) || 0);
  const totalQualified = Math.floor(Number(qualificationConfig?.totalQualified) || 0);
  if (!totalTeams || !groupCount || !totalQualified || totalTeams % groupCount !== 0 || totalQualified > totalTeams) {
    return { maximum: 0, baseline: 0, optionalGain: 0 };
  }

  const teamsPerGroup = totalTeams / groupCount;
  const directCount = Math.min(teamsPerGroup, Math.floor(totalQualified / groupCount));
  const additionalCount = totalQualified % groupCount;
  const additionalPosition = additionalCount > 0 ? directCount + 1 : null;
  const additionalSelected = new Set(
    Array.isArray(prediction.additionalQualifiedTeams)
      ? prediction.additionalQualifiedTeams.map(v => String(v).trim()).filter(Boolean)
      : []
  );

  const positions = Array.isArray(prediction.positions) ? prediction.positions : [];
  let maximum = 0;
  let baseline = 0;
  let optionalGain = 0;

  for (const raw of positions) {
    const team = String(raw?.team ?? '').trim();
    const pos = Number(raw?.position);
    if (!team || !Number.isInteger(pos) || pos <= 0 || pos > teamsPerGroup) continue;

    const isDirect = pos <= directCount;
    const predictedQualified = isDirect || additionalSelected.has(team);
    const positionCorrectPossible = true;
    const positionIncorrectPossible = teamsPerGroup > 1;

    const ruleValue = (actualQualified, actualNotQualified) => Math.max(
      ...rules.map(rule => getRulePointsForItem(rule, {
        team,
        predictedQualified,
        actualQualifiedPossible: actualQualified,
        actualNotQualifiedPossible: actualNotQualified,
        positionCorrectPossible,
        positionIncorrectPossible
      })),
      0
    );

    if (isDirect) {
      const value = ruleValue(true, false);
      maximum += value;
      baseline += value;
      continue;
    }

    const notQualifiedValue = ruleValue(false, true);
    baseline += notQualifiedValue;

    if (additionalCount > 0 && pos === additionalPosition && predictedQualified) {
      const qualifiedValue = ruleValue(true, false);
      maximum += qualifiedValue;
      optionalGain += Math.max(0, qualifiedValue - notQualifiedValue);
    } else {
      maximum += notQualifiedValue;
    }
  }

  return {
    maximum: Math.max(0, maximum),
    baseline: Math.max(0, baseline),
    optionalGain: Math.max(0, optionalGain)
  };
}

function calculateStrategyNonMatchFuturePotential(bet, {
  groupCompletionByGroup = new Map(),
  groupQualificationRules = [],
  scoringRules = {},
  championshipRules = {},
  championshipResults = {},
  hasGroupPhase = true,
  currentGroupQualificationByGroup = {}
} = {}) {
  if (!bet) return { total: 0, groupQualificationPoints: 0, extraPoints: 0 };

  const rules = Array.isArray(groupQualificationRules) ? groupQualificationRules : [];
  let groupQualificationPoints = 0;
  let extraPoints = 0;

  const groupPhaseEnabled = hasGroupPhase !== false && championshipRules?.hasGroupPhase !== false;
  const knockoutPhaseEnabled = championshipRules?.hasKnockoutPhase !== false;
  if (groupPhaseEnabled && knockoutPhaseEnabled && rules.length && Array.isArray(bet.groupPredictions)) {
    const qualificationConfig = championshipRules?.groupQualification || {};
    const totalTeams = Number(qualificationConfig.totalTeams || 0);
    const groupCount = Number(qualificationConfig.groupCount || 0);
    const totalQualified = Number(qualificationConfig.totalQualified || 0);
    const validQualificationConfig =
      totalTeams > 0 && groupCount > 0 && totalQualified > 0 &&
      totalTeams % groupCount === 0 && totalQualified <= totalTeams;

    const hasStatusRule = rules.some(rule => rule.conditions.some(c => c === 'teamQualified' || c === 'teamNotQualified'));
    if (validQualificationConfig || !hasStatusRule) {
      const optionalCandidates = [];
      const groupResults = [];
      for (const prediction of bet.groupPredictions) {
        const group = String(prediction?.group || '').trim();
        if (!group) continue;
        const state = groupCompletionByGroup.get(group);
        if (state?.complete === true) continue;

        const result = calculateGroupPredictionMaximum(
          prediction,
          state || { complete: false },
          rules,
          qualificationConfig
        );
        const alreadyAwarded = Math.max(0, Number(currentGroupQualificationByGroup?.[group] || 0));
        groupResults.push({ result, alreadyAwarded });
        const optionalAlreadyConsumed = Math.max(0, alreadyAwarded - result.baseline);
        const remainingOptionalGain = Math.max(0, result.optionalGain - optionalAlreadyConsumed);
        if (remainingOptionalGain > 0) optionalCandidates.push(remainingOptionalGain);
      }

      // As vagas adicionais são globais entre os grupos. Uma configuração
      // 48/12/32 possui somente 8 vagas de terceiro lugar, portanto o teto não
      // pode conceder o bônus de terceiro lugar a 12 grupos simultaneamente.
      const additionalCount = totalQualified % groupCount;
      const allowedOptionalGain = optionalCandidates
        .sort((a, b) => b - a)
        .slice(0, additionalCount)
        .reduce((sum, value) => sum + value, 0);

      groupQualificationPoints = groupResults.reduce((sum, item) => {
        const baselineFuture = Math.max(0, item.result.baseline - item.alreadyAwarded);
        return sum + baselineFuture;
      }, 0) + allowedOptionalGain;

    }
  }

  const extraKeys = ['topScorer', 'bestAttack', 'worstDefense', 'upset'];
  for (const key of extraKeys) {
    const predicted = bet?.extras?.[key];
    const official = championshipResults?.[key];
    const points = Math.max(0, Number(scoringRules?.[key]) || 0);
    if (points > 0 && String(predicted ?? '').trim() !== '' && String(official ?? '').trim() === '') {
      extraPoints += points;
    }
  }

  return {
    total: Math.max(0, groupQualificationPoints + extraPoints),
    groupQualificationPoints: Math.max(0, groupQualificationPoints),
    extraPoints: Math.max(0, extraPoints)
  };
}

module.exports = {
  calculateStrategyNonMatchFuturePotential,
  calculateGroupPredictionMaximum
};
