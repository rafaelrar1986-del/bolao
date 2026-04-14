const Match = require('../models/Match');

// Caches organizados por LeagueID para não misturar campeonatos
let cacheOficial = {}; // Ex: { "1": data, "2": data }
let cacheParcial = {};
let lastCacheOficial = {};
let lastCacheParcial = {};
const CACHE_DURATION = 30000;

const getGroupStandings = async (req, res) => {
  const now = Date.now();
  const isLiveRequest = req.query.live === 'true';
  const leagueId = req.query.leagueId ? Number(req.query.leagueId) : null;

  if (!leagueId) {
    return res.status(400).json({ error: 'leagueId é obrigatório para calcular a classificação.' });
  }

  // 1. Verificação de Cache por Liga
  if (!isLiveRequest && cacheOficial[leagueId] && (now - lastCacheOficial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheOficial[leagueId]);
  }
  if (isLiveRequest && cacheParcial[leagueId] && (now - lastCacheParcial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheParcial[leagueId]);
  }

  try {
    // 2. Busca partidas apenas da liga solicitada
    const allMatches = await Match.find({ leagueId, phase: 'group' }).lean();
    
    if (!allMatches.length) {
      return res.json({});
    }

    const standings = {};

    // 3. Inicializar times encontrados nas partidas desta liga
    allMatches.forEach(m => {
      [m.teamA, m.teamB].forEach(t => {
        if (!standings[t]) {
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

    // 5. Processar tabela geral
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

    // 6. Agrupar por Grupo (A, B, C...)
    const groupedResults = {};
    Object.values(standings).forEach(t => {
      if (!groupedResults[t.group]) groupedResults[t.group] = [];
      groupedResults[t.group].push(t);
    });

    // 7. Aplicar Ordenação (Critérios: Pts > SG > GP > Confronto Direto)
    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        const diffPts = b.pts - a.pts;
        if (diffPts !== 0) return diffPts;

        const diffSG = b.sg - a.sg;
        if (diffSG !== 0) return diffSG;

        const diffGP = b.gp - a.gp;
        if (diffGP !== 0) return diffGP;

        // --- CONFRONTO DIRETO ---
        const h2hMatch = activeMatches.find(m => 
          (m.teamA === a.name && m.teamB === b.name) || 
          (m.teamA === b.name && m.teamB === a.name)
        );

        if (h2hMatch && typeof h2hMatch.scoreA === 'number') {
          let scoreA_h2h, scoreB_h2h;
          if (h2hMatch.teamA === a.name) {
            scoreA_h2h = h2hMatch.scoreA;
            scoreB_h2h = h2hMatch.scoreB;
          } else {
            scoreA_h2h = h2hMatch.scoreB;
            scoreB_h2h = h2hMatch.scoreA;
          }

          if (scoreA_h2h > scoreB_h2h) return -1;
          if (scoreB_h2h > scoreA_h2h) return 1;
        }

        return a.name.localeCompare(b.name);
      });
    }

    // 8. Melhores Terceiros (Ajustado para o formato do Mundial 2026: 12 grupos, 8 melhores 3ºs)
    const allThirdPlaces = Object.values(groupedResults).map(g => g[2]).filter(Boolean);
    allThirdPlaces.sort((a, b) => 
      b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.name.localeCompare(b.name)
    );

    const best8 = allThirdPlaces.slice(0, 8).map(t => t.name);

    // 9. Marcar Qualificados
    for (const g in groupedResults) {
      groupedResults[g].forEach((t, i) => {
        // Qualificam os 2 primeiros OU se estiver entre os 8 melhores terceiros
        t.qualified = (i < 2 || (i === 2 && best8.includes(t.name)));
      });
    }

    // 10. Atualizar Cache da Liga
    if (isLiveRequest) { 
      cacheParcial[leagueId] = groupedResults; 
      lastCacheParcial[leagueId] = now; 
    } else { 
      cacheOficial[leagueId] = groupedResults; 
      lastCacheOficial[leagueId] = now; 
    }

    res.json(groupedResults);
  } catch (error) {
    console.error(`Erro ao calcular classificação da liga ${leagueId}:`, error);
    res.status(500).json({ error: 'Erro interno ao processar classificação.' });
  }
};

module.exports = { getGroupStandings };
