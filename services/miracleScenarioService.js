'use strict';

/**
 * Constrói o universo de resultados possíveis para o Milagre.
 * Regra deliberada: placares de partidas futuras vão de 0x0 a 7x7.
 * Resultados já ocorridos são preservados e nunca são reduzidos.
 */

const { getEffectiveKnockoutFormat } = require('../utils/knockoutFormat');
const { getKnockoutConfrontationKey, validateHomeAwayLegs, getCanonicalTeamPair } = require('../utils/knockoutConfrontationKey');

const LIVE_STATUSES = new Set([
  '1_tempo', 'intervalo', '2_tempo', 'prorrogacao',
  '1_tet', '2_tet', 'penaltis', 'live', 'in_progress', 'ao_vivo'
]);

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isKnockout(match) {
  return match?.phase === 'knockout' || match?.phase === 'mata-mata';
}

function isCancelledOrPostponed(match) {
  return ['cancelled', 'postponed'].includes(String(match?.status || '').toLowerCase());
}

function isFinished(match) {
  return match?.status === 'finished';
}

function isLive(match) {
  return LIVE_STATUSES.has(String(match?.status || '').toLowerCase());
}

function outcomeFromScore(a, b) {
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

function addOutcome(list, seen, outcome) {
  const key = `${outcome.scoreA}:${outcome.scoreB}:${outcome.winner || ''}:${outcome.qualifier || ''}`;
  if (!seen.has(key)) {
    seen.add(key);
    list.push(outcome);
  }
}

function generateScorePairs(minA = 0, minB = 0, max = 7) {
  const out = [];
  for (let a = Math.max(0, minA); a <= max; a++) {
    for (let b = Math.max(0, minB); b <= max; b++) {
      out.push([a, b]);
    }
  }
  return out;
}

/**
 * Gera somente resultados matematicamente coerentes para uma partida.
 * winner/qualifier existentes no documento são tratados como restrições.
 */
function generateMatchOutcomes(match, championshipRules = {}) {
  if (!match || isCancelledOrPostponed(match)) return [];

  const status = String(match.status || '').toLowerCase();
  const finished = isFinished(match);
  const live = isLive(match);
  const aNow = num(match.scoreA);
  const bNow = num(match.scoreB);
  const isKO = isKnockout(match);

  // Resultado oficial: completamente fixo. Se não houver placar, não inventar.
  if (finished) {
    if (aNow == null || bNow == null) {
      // Alguns fluxos administrativos podem encerrar uma partida informando
      // apenas o classificado. Esse estado não fornece placar para pontuação,
      // mas é um estado válido de classificação e não deve ser inventado.
      const qualifier = match.qualifiedSide === 'A' || match.qualifiedSide === 'B'
        ? match.qualifiedSide : null;
      if (!qualifier) return [];
      return [{
        scoreA: aNow, scoreB: bNow, winner: null, qualifier,
        fixed: true, reason: 'finished-with-qualifier-only'
      }];
    }

    const homeAway = isKO && getEffectiveKnockoutFormat(championshipRules || {}, match) === 'home_away';
    // O motor oficial de pontuação pode considerar o resultado do tempo normal
    // quando drawIncludesExtraTime=false. O Milagre deve expor o mesmo winner.
    const useFinalScore = Boolean(championshipRules?.drawIncludesExtraTime ?? false);
    const referenceA = useFinalScore ? aNow : (num(match.regularTimeScoreA) ?? aNow);
    const referenceB = useFinalScore ? bNow : (num(match.regularTimeScoreB) ?? bNow);
    const winner = outcomeFromScore(referenceA, referenceB);

    let qualifier = null;
    if (isKO) {
      // Override manual é a única fonte externa que pode fixar o classificado.
      if (match.qualifiedSideManuallySet === true && (match.qualifiedSide === 'A' || match.qualifiedSide === 'B')) {
        qualifier = match.qualifiedSide;
      } else if (homeAway) {
        // Em ida/volta, uma perna individual nunca define o classificado.
        qualifier = null;
      } else {
        const hasPenalties = match.penaltiesA != null && match.penaltiesB != null;
        if (hasPenalties) {
          const pa = Number(match.penaltiesA);
          const pb = Number(match.penaltiesB);
          if (!Number.isFinite(pa) || !Number.isFinite(pb)) return [];
          if (pa === pb) {
            // Disputa de pênaltis encerrada não pode terminar empatada.
            return [];
          }
          qualifier = pa > pb ? 'A' : 'B';
        } else {
          // Empate no resultado oficial sem pênaltis/classificado é estado
          // incompleto: não pode entrar no universo do Milagre.
          const finalQualifier = outcomeFromScore(aNow, bNow);
          if (finalQualifier === 'draw') return [];
          qualifier = finalQualifier;
        }
      }
    }
    return [{
      scoreA: aNow,
      scoreB: bNow,
      winner,
      qualifier,
      penaltiesA: num(match.penaltiesA),
      penaltiesB: num(match.penaltiesB),
      fixed: true
    }];
  }

  // Estados inválidos ficam fora do universo.
  if (!['scheduled', ...LIVE_STATUSES].includes(status)) return [];

  // Durante a disputa de pênaltis, o placar de gols já está encerrado:
  // não podemos continuar gerando gols até 7x7. O universo deve variar apenas
  // a classificação pelo desempate, e somente se o resultado dos pênaltis ainda
  // não estiver determinado.
  if (status === 'penaltis' && isKO && aNow != null && bNow != null) {
    const penaltyQualifier = match.penaltiesA != null && match.penaltiesB != null && Number(match.penaltiesA) !== Number(match.penaltiesB)
      ? (Number(match.penaltiesA) > Number(match.penaltiesB) ? 'A' : 'B')
      : null;
    const penaltyHomeAway = getEffectiveKnockoutFormat(championshipRules || {}, match) === 'home_away';
    // Mesmo em ida/volta, uma disputa de pênaltis em andamento pode resolver
    // o confronto (normalmente na segunda perna). Quando o shootout ainda não
    // está determinado, A/B são cenários distintos; não podemos devolver
    // qualifier=null porque isso perderia a informação necessária para resolver
    // o agregado no fim da busca.
    const qualifiers = penaltyQualifier ? [penaltyQualifier] : ['A', 'B'];
    return qualifiers.map(qualifier => ({
      scoreA: aNow,
      scoreB: bNow,
      winner: outcomeFromScore(aNow, bNow),
      qualifier,
      penaltiesA: num(match.penaltiesA),
      penaltiesB: num(match.penaltiesB),
      fixed: Boolean(penaltyQualifier),
      reason: penaltyHomeAway
        ? (penaltyQualifier ? 'penalty-shootout-home-away-resolved' : 'penalty-shootout-home-away-undetermined')
        : (penaltyQualifier ? 'penalty-shootout-resolved' : 'penalty-shootout-undetermined')
    }));
  }

  // Para partidas em andamento, o placar atual é piso. Acima de 7x7 não
  // tentamos inventar futuros: preservamos o estado atual como fixo.
  if (live && (aNow > 7 || bNow > 7)) {
    const winner = outcomeFromScore(aNow, bNow);
    const homeAway = isKO && getEffectiveKnockoutFormat(championshipRules || {}, match) === 'home_away';
    let qualifier = null;
    if (isKO) {
      if (match.qualifiedSideManuallySet === true && (match.qualifiedSide === 'A' || match.qualifiedSide === 'B')) qualifier = match.qualifiedSide;
      else if (!homeAway && match.penaltiesA != null && match.penaltiesB != null && Number(match.penaltiesA) !== Number(match.penaltiesB)) {
        qualifier = Number(match.penaltiesA) > Number(match.penaltiesB) ? 'A' : 'B';
      } else if (!homeAway && winner !== 'draw') qualifier = winner;
    }
    return [{ scoreA: aNow, scoreB: bNow, winner, qualifier, fixed: true, reason: 'live-score-over-limit' }];
  }

  const minA = live && aNow != null ? aNow : 0;
  const minB = live && bNow != null ? bNow : 0;
  const pairs = generateScorePairs(minA, minB, 7);
  const out = [];
  const seen = new Set();

  const registeredWinner = match.winner === 'A' || match.winner === 'B' || match.winner === 'draw'
    ? match.winner : null;
  // Para partidas ainda não finalizadas, qualifiedSide só é uma restrição
  // confiável quando foi explicitamente fixado pelo administrador. Um valor
  // residual/derivado não pode reduzir o universo do Milagre.
  const registeredQualifier = match.qualifiedSideManuallySet === true &&
    (match.qualifiedSide === 'A' || match.qualifiedSide === 'B')
    ? match.qualifiedSide : null;
  const registeredPenaltyQualifier = match.penaltiesA != null && match.penaltiesB != null && Number(match.penaltiesA) !== Number(match.penaltiesB)
    ? (Number(match.penaltiesA) > Number(match.penaltiesB) ? 'A' : 'B')
    : null;

  for (const [scoreA, scoreB] of pairs) {
    const winner = outcomeFromScore(scoreA, scoreB);

    // Definição acordada: empate é sempre empate; não criamos vencedor fictício.
    if (registeredWinner && registeredWinner !== winner) continue;

    let qualifiers = [null];
    if (isKO) {
      const homeAway = getEffectiveKnockoutFormat(championshipRules || {}, match) === 'home_away';
      if (homeAway) {
        // Ida/volta: a perna individual não define classificação.
        qualifiers = [null];
      } else if (winner === 'A' || winner === 'B') {
        qualifiers = [winner];
      } else {
        // Empate em jogo único: os dois desempates são cenários distintos.
        qualifiers = ['A', 'B'];
      }

      if (registeredQualifier) qualifiers = qualifiers.filter(q => q === registeredQualifier);
      if (!homeAway && registeredPenaltyQualifier) qualifiers = qualifiers.filter(q => q === registeredPenaltyQualifier);
      if (homeAway && registeredQualifier) {
        // Se o admin já fixou o classificado do confronto, preservamos a restrição.
        qualifiers = [registeredQualifier];
      }
    }

    for (const qualifier of qualifiers) {
      addOutcome(out, seen, {
        scoreA, scoreB, winner,
        qualifier: isKO ? qualifier : null,
        penaltiesA: null,
        penaltiesB: null,
        fixed: false
      });
    }
  }

  return out;
}

function validateOutcome(match, outcome) {
  if (!outcome) return false;
  const a = num(outcome.scoreA);
  const b = num(outcome.scoreB);
  if (a == null || b == null || a < 0 || b < 0) return false;

  if (isFinished(match)) {
    return a === num(match.scoreA) && b === num(match.scoreB);
  }

  if (isLive(match)) {
    const currentA = num(match.scoreA);
    const currentB = num(match.scoreB);
    if (currentA != null && a < currentA) return false;
    if (currentB != null && b < currentB) return false;
  }

  if (a <= 7 && b <= 7) return true;
  return isLive(match) && num(match.scoreA) === a && num(match.scoreB) === b;
}

function getAvailabilityConfigForPhase(match, settings = {}) {
  const phase = String(match?.phase || '').trim().toLowerCase();
  if (phase === 'group' || phase === 'groups' || phase === 'grupo' || phase === 'grupos') {
    return {
      mode: settings?.groupBetAvailabilityMode,
      unlocked: settings?.unlockedGroupRounds,
      locked: settings?.lockedGroupRounds
    };
  }
  if (phase === 'pontos_corridos' || phase === 'points_run') {
    return {
      mode: settings?.pointsRunBetAvailabilityMode,
      unlocked: settings?.unlockedPointsRunRounds,
      locked: settings?.lockedPointsRunRounds
    };
  }
  if (phase === 'knockout' || phase === 'mata-mata' || phase === 'mata_mata') {
    return {
      mode: settings?.knockoutBetAvailabilityMode,
      unlocked: settings?.unlockedKnockoutRounds,
      locked: settings?.lockedKnockoutRounds
    };
  }
  return null;
}

/**
 * Define o universo de apostas que o Milagre pode analisar.
 * "all" significa todas as rodadas daquela fase; "round" exige que a rodada
 * esteja explicitamente liberada e não esteja explicitamente bloqueada.
 * Isso controla ESCOPO de aposta, não o bloqueio temporal da partida: uma
 * rodada já iniciada continua no universo para que os palpites já feitos nela
 * possam ser avaliados contra os resultados ainda futuros.
 */
function isMatchInMiracleBettingScope(match, settings = {}) {
  if (!match) return false;
  const cfg = getAvailabilityConfigForPhase(match, settings);
  if (!cfg) return false;
  if (cfg.mode !== 'round') return true;

  const round = Number(match.roundNumber);
  if (!Number.isInteger(round) || round <= 0) return false;

  const unlocked = Array.isArray(cfg.unlocked) ? cfg.unlocked.map(Number) : [];
  const locked = Array.isArray(cfg.locked) ? cfg.locked.map(Number) : [];
  if (locked.includes(round)) return false;
  return unlocked.includes(round);
}

function buildScenarioUniverse(matches, championshipRules = {}) {
  const included = [];
  const excluded = [];
  for (const match of matches || []) {
    const outcomes = generateMatchOutcomes(match, championshipRules);
    if (outcomes.length === 0) excluded.push({ match, reason: 'no-valid-outcome' });
    else included.push({ match, outcomes });
  }
  return { included, excluded };
}


/**
 * Resolve confrontos ida/volta dentro de um cenário já materializado.
 * Não altera os documentos reais; retorna decisões possíveis para o cenário.
 * Quando o agregado empata e não existe desempate determinístico disponível,
 * A e B são mantidos como dois cenários válidos.
 */
function confrontationFormat(match, championshipRules = {}) {
  if (!match) return false;
  if (match.stageFormat === 'home_away') return true;
  if (match.stageFormat === 'single') return false;
  return getEffectiveKnockoutFormat(championshipRules, match) === 'home_away';
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Identidade segura de confronto: delegada ao utilitário compartilhado.
 * Não usamos group/roundName/roundNumber isoladamente.
 */
function confrontationKey(match) {
  return getKnockoutConfrontationKey(match);
}

function resolveScenarioConfrontation(legs, championshipRules = {}) {
  const expectedLegs = 2;
  const validation = validateHomeAwayLegs(legs, expectedLegs);
  if (!validation.valid) {
    if (validation.reason === 'expected-two-legs') {
      return { status: Array.isArray(legs) && legs.length < 2 ? 'incomplete' : 'invalid', qualifiers: [] };
    }
    return { status: 'invalid', qualifiers: [], reason: validation.reason };
  }

  const ordered = [...legs].sort((a, b) => {
    const la = Number(a?.knockoutLeg);
    const lb = Number(b?.knockoutLeg);
    if (Number.isFinite(la) && Number.isFinite(lb) && la !== lb) return la - lb;
    return Number(a?.matchId || 0) - Number(b?.matchId || 0);
  });

  if (!ordered.every(m => m?.status === 'finished' && num(m.scoreA) != null && num(m.scoreB) != null)) {
    return { status: 'incomplete', qualifiers: [null] };
  }

  const pair = getCanonicalTeamPair(ordered[0]);
  if (!pair) return { status: 'invalid', qualifiers: [], reason: 'missing-teams' };
  // A/B do confronto permanecem ancorados na primeira perna; o par canônico
  // acima serve somente para validar que a outra perna contém as mesmas equipes.
  const canonicalA = normalizeKey(ordered[0].teamA);
  const canonicalB = normalizeKey(ordered[0].teamB);

  // Um qualifiedSide só é uma decisão prévia do confronto quando o admin
  // marcou explicitamente a partida como override manual. Valores derivados
  // ou residuais não podem decidir o agregado.
  const manualQualifiers = new Set();
  const scenarioQualifiers = new Set();
  for (const m of ordered) {
    if (m?.scenarioConfrontationQualifier === true) {
      const q = m.qualifiedSide === 'A' || m.qualifiedSide === 'B' ? m.qualifiedSide : null;
      if (!q) return { status: 'invalid', qualifiers: [], reason: 'scenario-qualifier-without-side' };
      const team = q === 'A' ? normalizeKey(m.teamA) : normalizeKey(m.teamB);
      if (team === canonicalA) scenarioQualifiers.add('A');
      else if (team === canonicalB) scenarioQualifiers.add('B');
      else return { status: 'invalid', qualifiers: [], reason: 'scenario-qualifier-team-mismatch' };
    }
    if (m?.qualifiedSideManuallySet !== true) continue;
    const q = m.qualifiedSide === 'A' || m.qualifiedSide === 'B' ? m.qualifiedSide : null;
    if (!q) return { status: 'invalid', qualifiers: [], reason: 'manual-qualifier-without-side' };
    const team = q === 'A' ? normalizeKey(m.teamA) : normalizeKey(m.teamB);
    if (team === canonicalA) manualQualifiers.add('A');
    else if (team === canonicalB) manualQualifiers.add('B');
    else return { status: 'invalid', qualifiers: [], reason: 'manual-qualifier-team-mismatch' };
  }
  if (manualQualifiers.size > 1 || scenarioQualifiers.size > 1 ||
      (manualQualifiers.size === 1 && scenarioQualifiers.size === 1 && [...manualQualifiers][0] !== [...scenarioQualifiers][0])) {
    return { status: 'invalid', qualifiers: [], reason: 'conflicting-qualifier-resolution' };
  }
  if (manualQualifiers.size === 1) {
    return { status: 'resolved', qualifiers: [...manualQualifiers], manual: true };
  }
  if (scenarioQualifiers.size === 1) {
    return { status: 'resolved', qualifiers: [...scenarioQualifiers], scenario: true };
  }

  const total = (team) => ordered.reduce((sum, m) => {
    const a = normalizeKey(m.teamA);
    const b = normalizeKey(m.teamB);
    if (a === team) return sum + Number(m.scoreA || 0);
    if (b === team) return sum + Number(m.scoreB || 0);
    // validateHomeAwayLegs already guarantees the same two teams.
    return sum;
  }, 0);

  const totalA = total(canonicalA);
  const totalB = total(canonicalB);
  if (totalA !== totalB) {
    return { status: 'resolved', qualifiers: [totalA > totalB ? 'A' : 'B'], totalA, totalB };
  }

  if (championshipRules?.knockoutAwayGoals) {
    const away = (team) => ordered.reduce((sum, m) => {
      const a = normalizeKey(m.teamA);
      return sum + (a === team ? 0 : Number(m.scoreB || 0));
    }, 0);
    const awayA = away(canonicalA);
    const awayB = away(canonicalB);
    if (awayA !== awayB) {
      return { status: 'resolved', qualifiers: [awayA > awayB ? 'A' : 'B'], totalA, totalB, awayA, awayB };
    }
  }

  // Empate no agregado: pênaltis da última perna resolvem o confronto.
  const lastLeg = ordered[ordered.length - 1];
  if (lastLeg?.penaltiesA != null && lastLeg?.penaltiesB != null && Number(lastLeg.penaltiesA) !== Number(lastLeg.penaltiesB)) {
    const lastTeamA = normalizeKey(lastLeg.teamA);
    const winnerTeam = Number(lastLeg.penaltiesA) > Number(lastLeg.penaltiesB)
      ? lastTeamA
      : normalizeKey(lastLeg.teamB);
    if (winnerTeam === canonicalA) return { status: 'resolved', qualifiers: ['A'], totalA, totalB, byPenalties: true };
    if (winnerTeam === canonicalB) return { status: 'resolved', qualifiers: ['B'], totalA, totalB, byPenalties: true };
    return { status: 'invalid', qualifiers: [], reason: 'penalty-team-mismatch' };
  }

  // Sem critério determinístico disponível, ambos os desempates são cenários válidos.
  return { status: 'branch', qualifiers: ['A', 'B'], totalA, totalB };
}

/**
 * Para um scenarioMap, produz todas as resoluções necessárias dos confrontos
 * ida/volta. A explosão aqui é somente sobre desempates agregados ainda
 * indeterminados (normalmente A/B), nunca sobre placares novamente.
 */
function materializeScenarioConfrontations(
  scenarioMap,
  championshipRules = {},
  scopeMatchIds = null
) {
  const groups = new Map();
  const scopedIds = scopeMatchIds instanceof Set
    ? new Set([...scopeMatchIds].map(String))
    : Array.isArray(scopeMatchIds)
      ? new Set(scopeMatchIds.map(String))
      : null;

  for (const match of scenarioMap instanceof Map ? scenarioMap.values() : []) {
    // O scenarioMap pode conter todas as partidas da liga porque o motor oficial
    // de pontuação precisa delas para calcular histórico, previsões de grupo etc.
    // A materialização de confrontos do Milagre, porém, deve enxergar somente as
    // partidas pertencentes à rodada/fase atualmente liberada. Caso contrário,
    // uma segunda perna já cadastrada numa rodada futura pode completar ou
    // invalidar prematuramente um confronto que ainda não está no universo de
    // apostas do Milagre.
    if (scopedIds && !scopedIds.has(String(match?.matchId))) continue;
    if (!isKnockout(match) || !confrontationFormat(match, championshipRules)) continue;
    const key = confrontationKey(match);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }

  let variants = [{ scenarioMap: new Map(scenarioMap), confrontations: {} }];
  for (const [key, legs] of groups) {
    // Um confronto ida/volta deve ter exatamente duas pernas. Não somamos
    // silenciosamente três ou mais partidas que tenham caído na mesma chave.
    // Se somente uma perna pertence à rodada atualmente liberada, ela deve
    // permanecer como uma partida normal do universo. O classificado do
    // confronto ainda não existe e será resolvido quando a outra rodada for
    // liberada. Três ou mais pernas, porém, continuam sendo configuração
    // inválida.
    if (legs.length === 1) continue;
    if (legs.length !== 2) return [];

    // Com as duas pernas no escopo, o confronto pode ser resolvido normalmente.
    // avaliável: não atribuimos classificação parcial nem pontos de classificado.
    const resolution = resolveScenarioConfrontation(legs, championshipRules);
    if (resolution.status === 'invalid' || resolution.status === 'incomplete') return [];

    const next = [];
    for (const variant of variants) {
      for (const qualifier of resolution.qualifiers) {
        const map = new Map(variant.scenarioMap);
        const orderedLegs = [...legs].sort((a, b) => Number(a.knockoutLeg || 999) - Number(b.knockoutLeg || 999) || Number(a.matchId) - Number(b.matchId));
        const first = orderedLegs[0];
        const last = orderedLegs[orderedLegs.length - 1];
        if (first && qualifier) {
          // O pointsService resolve o confronto a partir da primeira perna,
          // enquanto o desempate final sem gols fora consulta a última perna.
          // A posição A/B é relativa a CADA perna: se os mandos forem invertidos,
          // o mesmo classificado canônico pode ser lado B na volta.
          const canonicalTeam = qualifier === 'A' ? normalizeKey(orderedLegs[0].teamA) : normalizeKey(orderedLegs[0].teamB);
          const sideForLeg = (leg) => normalizeKey(leg.teamA) === canonicalTeam ? 'A' :
            (normalizeKey(leg.teamB) === canonicalTeam ? 'B' : null);
          const firstSide = sideForLeg(first);
          const lastSide = sideForLeg(last);
          if (firstSide) map.set(String(first.matchId), { ...map.get(String(first.matchId)), qualifiedSide: firstSide, scenarioConfrontationQualifier: true });
          if (lastSide) map.set(String(last.matchId), { ...map.get(String(last.matchId)), qualifiedSide: lastSide, scenarioConfrontationQualifier: true });
        }
        next.push({
          scenarioMap: map,
          confrontations: {
            ...variant.confrontations,
            [key]: { qualifier, totalA: resolution.totalA, totalB: resolution.totalB }
          }
        });
      }
    }
    variants = next;
  }

  return variants;
}

module.exports = {
  LIVE_STATUSES,
  isKnockout,
  isFinished,
  isLive,
  outcomeFromScore,
  generateMatchOutcomes,
  validateOutcome,
  buildScenarioUniverse,
  getAvailabilityConfigForPhase,
  isMatchInMiracleBettingScope,
  resolveScenarioConfrontation,
  materializeScenarioConfrontations
};
