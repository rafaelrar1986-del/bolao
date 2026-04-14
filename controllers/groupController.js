const Match = require('../models/Match');

// Caches organizados por LeagueID
let cacheOficial = {};
let cacheParcial = {};
let lastCacheOficial = {};
let lastCacheParcial = {};
const CACHE_DURATION = 30000;

const getGroupStandings = async (req, res) => {
  const now = Date.now();
  const isLiveRequest = req.query.live === 'true';
  
  // Ajuste: Fallback para a liga 1 caso não venha no query
  let leagueId = req.query.leagueId ? Number(req.query.leagueId) : 1;

  // 1. Verificação de Cache por Liga (Prevenção de undefined)
  if (!isLiveRequest && cacheOficial[leagueId] && (now - lastCacheOficial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheOficial[leagueId]);
  }
  if (isLiveRequest && cacheParcial[leagueId] && (now - lastCacheParcial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheParcial[leagueId]);
  }

  try {
    // 2. Busca partidas apenas da liga solicitada
    // Adicionamos um log temporário para você conferir no terminal do Render/Node
    console.log(`[Standings] Calculando liga: ${leagueId} | Live: ${isLiveRequest}`);

    const allMatches = await Match.find({ leagueId, phase: 'group' }).lean();
    
    if (!allMatches || allMatches.length === 0) {
      // Se não houver partidas, retornamos um objeto vazio, mas limpamos o cache antigo
      return res.json({});
    }

    const standings = {};

    // 3. Inicializar times
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

    // 4. Filtrar partidas conforme o modo (Live ou Oficial)
    const activeMatches = allMatches.filter(m => 
      isLiveRequest ? m.status !== 'scheduled' : m.status === 'finished'
    );

    // 5. Processar tabela
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

    // 6. Agrupar por Grupo
    const groupedResults = {};
    Object.values(standings).forEach(t => {
      if (!groupedResults[t.group]) groupedResults[t.group] = [];
      groupedResults[t.group].push(t);
    });

    // 7. Ordenação (Pts > SG > GP > Confronto Direto)
    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.sg !== a.sg) return b.sg - a.sg;
        if (b.gp !== a.gp) return b.gp - a.gp;

        const h2h = activeMatches.find(m => 
          (m.teamA === a.name && m.teamB === b.name) || 
          (m.teamA === b.name && m.teamB === a.name)
        );

        if (h2h && typeof h2h.scoreA === 'number') {
          const aScore = h2h.teamA === a.name ? h2h.scoreA : h2h.scoreB;
          const bScore = h2h.teamA === b.name ? h2h.scoreA : h2h.scoreB;
          if (aScore !== bScore) return bScore - aScore;
        }
        return a.name.localeCompare(b.name);
      });
    }

    // 8. Melhores Terceiros (Regra Copa 2026: 12 grupos -> 8 melhores)
    const allThirdPlaces = Object.values(groupedResults)
      .map(g => g[2])
      .filter(Boolean)
      .sort((a, b) => b.pts - a.pts || b.sg - a.sg || b.gp - a.gp);

    const best8Names = allThirdPlaces.slice(0, 8).map(t => t.name);

    // 9. Marcar Qualificados
    for (const g in groupedResults) {
      groupedResults[g].forEach((t, i) => {
        t.qualified = (i < 2 || (i === 2 && best8Names.includes(t.name)));
      });
    }

    // 10. Salvar Cache
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

module.exports = { getGroupStandings };
