const Match = require('../models/Match');

// Caches separados
let cacheOficial = null;
let cacheParcial = null;
let lastCacheOficial = 0;
let lastCacheParcial = 0;
const CACHE_DURATION = 30000;

const getGroupStandings = async (req, res) => {
  const now = Date.now();
  const isLiveRequest = req.query.live === 'true';

  if (!isLiveRequest && cacheOficial && (now - lastCacheOficial < CACHE_DURATION)) return res.json(cacheOficial);
  if (isLiveRequest && cacheParcial && (now - lastCacheParcial < CACHE_DURATION)) return res.json(cacheParcial);

  try {
    const allMatches = await Match.find({ phase: 'group' }).lean();
    const standings = {};

    // 1. Inicializar times
    allMatches.forEach(m => {
      [m.teamA, m.teamB].forEach(t => {
        if (!standings[t]) {
          standings[t] = { name: t, group: m.group, pj: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0, qualified: false };
        }
      });
    });

    // 2. Filtrar partidas conforme o modo (Live ou Oficial)
    const activeMatches = allMatches.filter(m => isLiveRequest ? m.status !== 'scheduled' : m.status === 'finished');

    // 3. Processar tabela geral
    activeMatches.forEach(m => {
      const { teamA, teamB, scoreA, scoreB } = m;
      if (typeof scoreA === 'number' && typeof scoreB === 'number') {
        const sA = standings[teamA];
        const sB = standings[teamB];
        sA.pj++; sB.pj++;
        sA.gp += scoreA; sA.gc += scoreB;
        sB.gp += scoreB; sB.gc += scoreA;
        if (scoreA > scoreB) { sA.v++; sA.pts += 3; sB.d++; }
        else if (scoreB > scoreA) { sB.v++; sB.pts += 3; sA.d++; }
        else { sA.e++; sA.pts += 1; sB.e++; sB.pts += 1; }
        sA.sg = sA.gp - sA.gc; sB.sg = sB.gp - sB.gc;
      }
    });

    // 4. Agrupar e Aplicar Ordenação com Confronto Direto
    const groupedResults = {};
    Object.values(standings).forEach(t => {
      if (!groupedResults[t.group]) groupedResults[t.group] = [];
      groupedResults[t.group].push(t);
    });

    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        // Critérios Gerais
        const diffPts = b.pts - a.pts;
        if (diffPts !== 0) return diffPts;

        const diffSG = b.sg - a.sg;
        if (diffSG !== 0) return diffSG;

        const diffGP = b.gp - a.gp;
        if (diffGP !== 0) return diffGP;

        // --- CRITÉRIO 4: CONFRONTO DIRETO ---
        // Procuramos o jogo entre A e B dentro das partidas ativas
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

          if (scoreA_h2h > scoreB_h2h) return -1; // A ganha
          if (scoreB_h2h > scoreA_h2h) return 1;  // B ganha
        }

        // Critério final: Ordem Alfabética
        return a.name.localeCompare(b.name);
      });
    }

    // 5. Melhores terceiros (Sem confronto direto entre grupos diferentes)
    const allThirdPlaces = Object.values(groupedResults).map(g => g[2]).filter(Boolean);
    allThirdPlaces.sort((a, b) => b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.name.localeCompare(b.name));

    const best8 = allThirdPlaces.slice(0, 8).map(t => t.name);

    // 6. Marcar Qualificados
    for (const g in groupedResults) {
      groupedResults[g].forEach((t, i) => {
        t.qualified = (i < 2 || (i === 2 && best8.includes(t.name)));
      });
    }

    if (isLiveRequest) { cacheParcial = groupedResults; lastCacheParcial = now; }
    else { cacheOficial = groupedResults; lastCacheOficial = now; }

    res.json(groupedResults);
  } catch (error) {
    res.status(500).json({ error: 'Erro interno.' });
  }
};

module.exports = { getGroupStandings };
