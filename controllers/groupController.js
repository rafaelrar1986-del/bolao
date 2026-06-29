const Match = require('../models/Match');

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
const getGroupStandings = async (req, res) => {
  const now = Date.now();
  const isLiveRequest = req.query.live === 'true';
  
  let leagueId = req.query.leagueId ? Number(req.query.leagueId) : 1;

  if (!isLiveRequest && cacheOficial[leagueId] && (now - lastCacheOficial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheOficial[leagueId]);
  }
  if (isLiveRequest && cacheParcial[leagueId] && (now - lastCacheParcial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheParcial[leagueId]);
  }

  try {
    console.log(`[Standings] Calculando liga: ${leagueId} | Live: ${isLiveRequest}`);

    const allMatches = await Match.find({ leagueId, phase: 'group' }).lean();
    
    if (!allMatches || allMatches.length === 0) {
      return res.json({});
    }

    const standings = {};

    allMatches.forEach(m => {
      [m.teamA, m.teamB].forEach(t => {
        if (t && !standings[t]) {
          standings[t] = { 
            name: t, 
            group: m.group, 
            pj: 0, v: 0, e: 0, d: 0, 
            gp: 0, gc: 0, sg: 0, pts: 0, 
            qualified: false 
          };
        }
      });
    });

    const activeMatches = allMatches.filter(m => 
      isLiveRequest ? m.status !== 'scheduled' : m.status === 'finished'
    );

    activeMatches.forEach(m => {
      const { teamA, teamB, scoreA, scoreB } = m;
      if (typeof scoreA === 'number' && typeof scoreB === 'number') {
        const sA = standings[teamA];
        const sB = standings[teamB];
        
        if (sA && sB) {
          sA.pj++; sB.pj++;
          sA.gp += scoreA; sA.gc += scoreB;
          sB.gp += scoreB; sB.gc += scoreA;
          
          if (scoreA > scoreB) { 
            sA.v++; sA.pts += 3; sB.d++; 
          } else if (scoreB > scoreA) { 
            sB.v++; sB.pts += 3; sA.d++; 
          } else { 
            sA.e++; sA.pts += 1; sB.e++; sB.pts += 1; 
          }
          sA.sg = sA.gp - sA.gc; 
          sB.sg = sB.gp - sB.gc;
        }
      }
    });

    const groupedResults = {};
    Object.values(standings).forEach(t => {
      if (!groupedResults[t.group]) groupedResults[t.group] = [];
      groupedResults[t.group].push(t);
    });

    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;

        const h2hMatches = activeMatches.filter(m => 
          (m.teamA === a.name && m.teamB === b.name) || 
          (m.teamA === b.name && m.teamB === a.name)
        );

        let h2hPtsA = 0, h2hPtsB = 0;
        let h2hSgA = 0, h2hSgB = 0;
        let h2hGpA = 0, h2hGpB = 0;

        h2hMatches.forEach(m => {
          if (typeof m.scoreA === 'number' && typeof m.scoreB === 'number') {
            const golsA = m.teamA === a.name ? m.scoreA : m.scoreB;
            const golsB = m.teamA === b.name ? m.scoreA : m.scoreB;

            h2hGpA += golsA;
            h2hGpB += golsB;

            h2hSgA += (golsA - golsB);
            h2hSgB += (golsB - golsA);

            if (golsA > golsB) h2hPtsA += 3;
            else if (golsB > golsA) h2hPtsB += 3;
            else { h2hPtsA += 1; h2hPtsB += 1; }
          }
        });

        if (h2hPtsB !== h2hPtsA) return h2hPtsB - h2hPtsA;
        if (h2hSgB !== h2hSgA) return h2hSgB - h2hSgA;
        if (h2hGpB !== h2hGpA) return h2hGpB - h2hGpA;
        if (b.sg !== a.sg) return b.sg - a.sg;
        if (b.gp !== a.gp) return b.gp - a.gp;

        return a.name.localeCompare(b.name);
      });
    }

    const allThirdPlaces = Object.values(groupedResults)
      .map(g => g[2])
      .filter(Boolean)
      .sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.sg !== a.sg) return b.sg - a.sg;
        if (b.gp !== a.gp) return b.gp - a.gp;
        return a.name.localeCompare(b.name);
      });

    const best8Names = allThirdPlaces.slice(0, 8).map(t => t.name);

    for (const g in groupedResults) {
      groupedResults[g].forEach((t, i) => {
        t.qualified = (i < 2 || (i === 2 && best8Names.includes(t.name)));
      });
    }

    if (isLiveRequest) { 
      cacheParcial[leagueId] = groupedResults; 
      lastCacheParcial[leagueId] = now; 
    } else { 
      cacheOficial[leagueId] = groupedResults; 
      lastCacheOficial[leagueId] = now; 
    }

    res.json(groupedResults);
  } catch (error) {
    console.error(`[Error Standings] Liga ${leagueId}:`, error);
    res.status(500).json({ error: 'Erro ao processar classificação.' });
  }
};

/**
 * 2. FUNÇÃO CORRIGIDA: RETORNA AS CHAVES DO MATA-MATA (Alinhado ao Select e ao Match Schema)
 */
const getKnockoutMatches = async (req, res) => {
  const now = Date.now();
  let leagueId = req.query.leagueId ? Number(req.query.leagueId) : 1;

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

module.exports = { getGroupStandings, getKnockoutMatches };
