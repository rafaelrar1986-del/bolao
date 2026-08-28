const Match = require('../models/Match');
const Settings = require('../models/Settings');

// Caches organizados por LeagueID para a Fase de Grupos
let cacheOficial = {};
let cacheParcial = {};
let lastCacheOficial = {};
let lastCacheParcial = {};

// Caches organizados por LeagueID para o Mata-Mata
let cacheKnockout = {};
let lastCacheKnockout = {};

const CACHE_DURATION = 30000;

/**
 * 1. CLASSIFICAÇÃO DA FASE DE GRUPOS (Sua lógica original mantida)
 */
const { calculateGroupStandings } = require('../services/groupStandingsService');
const {
  calculateGroupQualificationPoints
} = require('../services/pointsService');

const getGroupStandings = async (req, res) => {
  const now = Date.now();
  const isLiveRequest = req.query.live === 'true';

  const leagueId = req.query.leagueId
    ? String(req.query.leagueId).trim()
    : 'default';
  const requestedPhase =
    req.query.phase === 'pontos_corridos'
      ? 'pontos_corridos'
      : 'group';

  const cacheKey = `${leagueId}:${requestedPhase}`;

  if (
    !isLiveRequest &&
    cacheOficial[cacheKey] &&
    now - lastCacheOficial[cacheKey] < CACHE_DURATION
  ) {
    return res.json(cacheOficial[cacheKey]);
  }

  if (
    isLiveRequest &&
    cacheParcial[cacheKey] &&
    now - lastCacheParcial[cacheKey] < CACHE_DURATION
  ) {
    return res.json(cacheParcial[cacheKey]);
  }

  try {
    console.log(
      `[Standings] Calculando liga: ${leagueId} | Live: ${isLiveRequest}`
    );

    const settings = await Settings.findById(leagueId).lean();
    if (requestedPhase === 'group' && settings?.championshipRules?.hasGroupPhase === false) {
      return res.json({});
    }

    const allMatches = await Match.find({
      leagueId,
      phase: requestedPhase
    }).lean();

    if (!allMatches || allMatches.length === 0) {
      return res.json({});
    }

    const activeMatches = allMatches
      .filter(m =>
        isLiveRequest
          ? m.status !== 'scheduled'
          : m.status === 'finished'
      )
      .map(m => ({
        ...m,
        // Pontos corridos sempre têm uma única classificação lógica.
        group:
          requestedPhase === 'pontos_corridos'
            ? (m.group || m.leagueName || 'Classificação Geral')
            : m.group
      }));

    const isPointsRun = requestedPhase === 'pontos_corridos';

    // ============================================================
    // FONTE ÚNICA DA VERDADE DA CLASSIFICAÇÃO
    // ============================================================
    // O algoritmo está em groupStandingsService.js e é compartilhado
    // pelo controller e pelo cálculo de pontuação.
    const standingsSourceMatches = allMatches.map(m => ({
      ...m,
      group:
        requestedPhase === 'pontos_corridos'
          ? (m.group || m.leagueName || 'Classificação Geral')
          : m.group
    }));

    // Calcula pontos somente com as partidas válidas para o modo solicitado,
    // mas usa TODAS as partidas da fase para manter a tabela visível desde o início.
    const groupedResults = calculateGroupStandings(
      activeMatches,
      standingsSourceMatches
    );

    /*
     * ============================================================
     * CLASSIFICAÇÃO GENÉRICA PARA O MATA-MATA
     * ============================================================
     * championshipRules.groupQualification define: total de times,
     * número de grupos e total de classificados.
     *
         * Sem configuração válida, nenhuma estrutura de classificação é presumida.
     */
    const qualification = !isPointsRun
      ? (settings?.championshipRules?.groupQualification || {})
      : {};

    const configuredTotalTeams = Number(qualification.totalTeams || 0);
    const configuredGroupCount = Number(qualification.groupCount || 0);
    const configuredTotalQualified = Number(qualification.totalQualified || 0);

    // Estrutura 100% configurável. Sem configuração válida, não há fallback.
    let baseQualifiedPerGroup = 0;
    let additionalQualifiedCount = 0;
    let additionalQualificationPosition = null;
    let qualificationMode = isPointsRun ? 'points_run' : 'unconfigured';

    if (
      configuredTotalTeams > 0 &&
      configuredGroupCount > 0 &&
      configuredTotalQualified > 0 &&
      configuredTotalTeams % configuredGroupCount === 0 &&
      configuredTotalQualified <= configuredTotalTeams
    ) {
      const teamsPerGroup = configuredTotalTeams / configuredGroupCount;
      const calculatedBase = Math.floor(
        configuredTotalQualified / configuredGroupCount
      );
      const calculatedAdditional =
        configuredTotalQualified % configuredGroupCount;

      if (
        calculatedBase <= teamsPerGroup &&
        (calculatedAdditional === 0 || calculatedBase < teamsPerGroup)
      ) {
        baseQualifiedPerGroup = calculatedBase;
        additionalQualifiedCount = calculatedAdditional;
        additionalQualificationPosition =
          calculatedAdditional > 0 ? calculatedBase + 1 : null;
        qualificationMode = 'configured';
      }
    }

    let additionalQualifiedNames = new Set();

    const rankCandidatesAtPosition = position => Object.values(groupedResults)
      .map(group => group[position - 1])
      .filter(Boolean)
      .sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.sg !== a.sg) return b.sg - a.sg;
        if (b.gp !== a.gp) return b.gp - a.gp;
        return a.name.localeCompare(b.name);
      });

    if (qualificationMode === 'configured' && additionalQualifiedCount > 0) {
      additionalQualifiedNames = new Set(
        rankCandidatesAtPosition(additionalQualificationPosition)
          .slice(0, additionalQualifiedCount)
          .map(t => t.name)
      );
    }

    const groupKeys = Object.keys(groupedResults);
    for (const g of groupKeys) {
      groupedResults[g].forEach((t, i) => {
        t.qualified =
          i < baseQualifiedPerGroup ||
          (additionalQualificationPosition !== null &&
            i === additionalQualificationPosition - 1 &&
            additionalQualifiedNames.has(t.name));
      });
    }

    // Metadados não fazem parte de um grupo e são removidos antes do cache/JSON.
    const qualificationMeta = {
      mode: qualificationMode,
      totalTeams: configuredTotalTeams || null,
      groupCount: configuredGroupCount || null,
      totalQualified: configuredTotalQualified || null,
      teamsPerGroup: configuredTotalTeams && configuredGroupCount
        ? configuredTotalTeams / configuredGroupCount
        : null,
      baseQualifiedPerGroup,
      additionalQualifiedCount,
      additionalQualificationPosition
    };
    Object.defineProperty(groupedResults, '__qualification', {
      value: qualificationMeta,
      enumerable: false,
      configurable: true
    });

    if (isLiveRequest) {
      cacheParcial[cacheKey] = groupedResults;
      lastCacheParcial[cacheKey] = now;
    } else {
      cacheOficial[cacheKey] = groupedResults;
      lastCacheOficial[cacheKey] = now;
    }

    res.json(groupedResults);
  } catch (error) {
    console.error(`[Error Standings] Liga ${leagueId}:`, error);
    res.status(500).json({ error: 'Erro ao processar classificação.' });
  }
};


/**
 * Calcula a pontuação da classificação prevista de um usuário.
 *
 * live=true  -> situação atual, incluindo partidas iniciadas.
 * live=false -> somente partidas finalizadas (pontuação oficial).
 *
 * A regra de pontuação é a mesma do pointsService, sem duplicação no frontend.
 */
const getGroupPredictionPoints = async (req, res) => {
  try {
    const leagueId = req.query.leagueId
      ? String(req.query.leagueId).trim()
      : '';

    if (!leagueId) {
      return res.status(400).json({ error: 'leagueId é obrigatório.' });
    }

    const settings = await Settings.findById(leagueId).lean();
    if (settings?.championshipRules?.hasGroupPhase === false) {
      return res.json({ points: 0, breakdown: [], byGroup: [], startedGroups: [] });
    }

    const predictions = Array.isArray(req.body?.groupPredictions)
      ? req.body.groupPredictions
      : [];

    if (!predictions.length) {
      return res.json({ points: 0, breakdown: [], byGroup: [], startedGroups: [] });
    }

    const live = req.query.live === 'true';

    const matches = await Match.find({
      leagueId,
      phase: 'group'
    }).lean();

    const relevantMatches = matches.filter(m =>
      live ? m.status !== 'scheduled' : m.status === 'finished'
    );

    const result = calculateGroupQualificationPoints(
      predictions,
      relevantMatches,
      settings?.scoringRules || {},
      settings?.championshipRules || {},
      live
    );

    const startedGroups = [...new Set(
      relevantMatches
        .filter(m => m.status !== 'scheduled')
        .map(m => String(m.group || '').trim())
        .filter(Boolean)
    )];

    return res.json({
      points: Number(result.points || 0),
      breakdown: Array.isArray(result.breakdown) ? result.breakdown : [],
      byGroup: Array.isArray(result.byGroup) ? result.byGroup : [],
      startedGroups
    });
  } catch (error) {
    console.error('[Prediction Points] Erro:', error);
    return res.status(500).json({
      error: 'Erro ao calcular pontuação da classificação prevista.'
    });
  }
};


/**
 * Pontuação da classificação prevista.
 * live=true: inclui partidas iniciadas (situação ao vivo).
 * live=false: somente partidas finalizadas (pontuação oficial).
 */


/**
 * 2. FUNÇÃO CORRIGIDA: RETORNA AS CHAVES DO MATA-MATA (Alinhado ao Select e ao Match Schema)
 */
const getKnockoutMatches = async (req, res) => {
  const now = Date.now();
  // 🆕 CORREÇÃO: leagueId é String no schema Match
  const leagueId = req.query.leagueId ? String(req.query.leagueId).trim() : 'default';
  const requestedPhase = req.query.phase === 'pontos_corridos' ? 'pontos_corridos' : 'group';

  if (cacheKnockout[leagueId] && (now - lastCacheKnockout[leagueId] < CACHE_DURATION)) {
    return res.json(cacheKnockout[leagueId]);
  }

  try {
    console.log(`[Knockout] Buscando chaves do mata-mata da liga: ${leagueId}`);

    // CORREÇÃO 1: Busca pelo campo 'phase' correto do Schema (Enum: knockout ou mata-mata)
    // CORREÇÃO 2: Ordena por data, hora e matchId (pois matchNumber não existe no Schema)
    const knockoutMatches = await Match.find({
      leagueId,
      phase: { $in: ['knockout', 'mata-mata'] }
    }).sort({ date: 1, time: 1, matchId: 1 }).lean();

    console.log(`[Knockout] Encontradas ${knockoutMatches.length} partidas no banco para esta liga.`);

    const phasesMap = {
      round_32: [],
      round_16: [],
      quarterfinals: [],
      semifinals: [],
      third_place: [],
      final: []
    };

    // CORREÇÃO 3: Distribuição exata e sem conflitos baseada nas opções do seu Select (phaseName)
    knockoutMatches.forEach(match => {
      const nameClean = match.phaseName ? match.phaseName.toLowerCase().trim() : '';
      
      if (nameClean.includes('16-avos')) {
        phasesMap.round_32.push(match); // "16-avos de final"
      } else if (nameClean.includes('oitavas')) {
        phasesMap.round_16.push(match); // "Oitavas de final"
      } else if (nameClean.includes('quartas')) {
        phasesMap.quarterfinals.push(match); // "Quartas de final"
      } else if (nameClean.includes('semi')) {
        phasesMap.semifinals.push(match); // "Semifinal"
      } else if (nameClean.includes('3º') || nameClean.includes('terceiro') || nameClean.includes('3o')) {
        phasesMap.third_place.push(match); // "3º lugar"
      } else if (nameClean === 'final' || nameClean.endsWith(' de final')) {
        phasesMap.final.push(match); // "Final"
      } else {
        phasesMap.final.push(match); // Fallback de segurança
      }
    });

    cacheKnockout[leagueId] = phasesMap;
    lastCacheKnockout[leagueId] = now;

    res.json(phasesMap);
  } catch (error) {
    console.error(`[Error Knockout] Falha na liga ${leagueId}:`, error);
    res.status(500).json({ error: 'Erro ao processar chaves eliminatórias.' });
  }
};

module.exports = { getGroupStandings, getGroupPredictionPoints, getKnockoutMatches };
