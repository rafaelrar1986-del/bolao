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
  const maxGroupRule = Math.max(
    ...rules.map(rule => Math.max(0, Number(rule?.points) || 0)),
    0
  );

  let groupQualificationPoints = 0;
  let extraPoints = 0;

  // O motor oficial zera toda a pontuação de classificação quando não há
  // fase de grupos. A Estratégia precisa respeitar exatamente essa regra.
  const groupPhaseEnabled = hasGroupPhase !== false && championshipRules?.hasGroupPhase !== false;
  const knockoutPhaseEnabled = championshipRules?.hasKnockoutPhase !== false;
  if (groupPhaseEnabled && knockoutPhaseEnabled && maxGroupRule > 0 && Array.isArray(bet.groupPredictions)) {
    // Sem uma configuração válida de total de equipes/grupos/vagas, o motor
    // oficial não pontua regras que dependem de status de classificação.
    // Para manter o teto seguro, retiramos essas regras do máximo quando a
    // configuração correspondente não é válida. Regras puramente posicionais
    // continuam elegíveis.
    // A configuração estrutural da classificação pertence ao campeonato,
    // não às regras de pontuação. O motor oficial lê championshipRules.groupQualification;
    // a Estratégia precisa usar a mesma fonte para que o teto futuro nunca diverja.
    const qualificationConfig = championshipRules?.groupQualification || {};
    const totalTeams = Number(qualificationConfig.totalTeams || 0);
    const groupCount = Number(qualificationConfig.groupCount || 0);
    const totalQualified = Number(qualificationConfig.totalQualified || 0);
    const validQualificationConfig =
      totalTeams > 0 &&
      groupCount > 0 &&
      totalQualified > 0 &&
      totalTeams % groupCount === 0 &&
      totalQualified <= totalTeams;

    // O cálculo oficial retorna imediatamente zero quando a configuração é
    // inválida e existe QUALQUER regra dependente de status de classificação.
    // Não podemos manter uma regra de posição isoladamente nesse cenário,
    // porque ela também fica sem pontuação no motor oficial.
    const hasStatusRule = rules.some(rule => rule.conditions.some(c =>
      c === 'teamQualified' || c === 'teamNotQualified'
    ));
    const eligibleRules = !validQualificationConfig && hasStatusRule
      ? []
      : rules;
    const eligibleMaxRule = Math.max(
      ...eligibleRules.map(rule => Math.max(0, Number(rule.points) || 0)),
      0
    );

    // O cálculo oficial só consegue atribuir pontos a posições preenchidas
    // por entradas normalizadas (posição inteira positiva + equipe). Não
    // contamos lixo de dados como potencial futuro. Duplicatas continuam
    // sendo contadas como entradas separadas aqui porque o motor oficial
    // avalia cada posição individualmente.
    for (const prediction of bet.groupPredictions) {
      const group = String(prediction?.group || '').trim();
      if (!group) continue;
      const state = groupCompletionByGroup.get(group);
      if (state?.complete === true) continue;

      const positions = Array.isArray(prediction?.positions)
        ? prediction.positions.filter(p =>
            Number.isInteger(Number(p?.position)) &&
            Number(p.position) > 0 &&
            String(p?.team ?? '').trim() !== ''
          )
        : [];

      const theoreticalMaximum = positions.length * eligibleMaxRule;
      const alreadyAwarded = Math.max(
        0,
        Number(currentGroupQualificationByGroup?.[group] || 0)
      );
      // Em modo LIVE, o motor oficial pode já ter atribuído pontos de
      // classificação antes do grupo terminar. O futuro só pode conter o
      // restante do teto, nunca o teto inteiro novamente.
      groupQualificationPoints += Math.max(0, theoreticalMaximum - alreadyAwarded);
    }
  }

  // Extras só podem gerar pontos futuros se o usuário realmente possui a
  // previsão e o resultado oficial ainda não foi definido.
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

module.exports = { calculateStrategyNonMatchFuturePotential };
