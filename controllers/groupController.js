const Match = require('../models/Match');

// Cache separado para Oficial e Parcial
let cacheOficial = null;
let cacheParcial = null;
let lastCacheOficial = 0;
let lastCacheParcial = 0;
const CACHE_DURATION = 30000; // Reduzi para 30s para ser mais dinâmico

const getGroupStandings = async (req, res) => {
  const now = Date.now();
  // Lógica do Toggle vinda da URL (?live=true)
  const isLiveRequest = req.query.live === 'true';

  // 1. Verificação de Cache (Independente para cada modo)
  if (!isLiveRequest && cacheOficial && (now - lastCacheOficial < CACHE_DURATION)) {
    return res.json(cacheOficial);
  }
  if (isLiveRequest && cacheParcial && (now - lastCacheParcial < CACHE_DURATION)) {
    return res.json(cacheParcial);
  }

  try {
    const allGroupMatches = await Match.find({ phase: 'group' }).lean();
    const standings = {};

    // 2. Inicializar times
    allGroupMatches.forEach((match) => {
      const { teamA, teamB, group } = match;
      [teamA, teamB].forEach((team) => {
        if (!standings[team]) {
          standings[team] = {
            name: team, group: group,
            pj: 0, v: 0, e: 0, d: 0,
            gp: 0, gc: 0, sg: 0, pts: 0,
            qualified: false
          };
        }
      });
    });

    // 3. FILTRO CRÍTICO: Decidir quais jogos entram no cálculo
    const matchesToProcess = allGroupMatches.filter(m => {
      if (isLiveRequest) {
        // Modo Parcial: Pega tudo que já começou ou terminou
        return m.status !== 'scheduled';
      } else {
        // Modo Oficial: APENAS o que já encerrou de fato
        return m.status === 'finished';
      }
    });

    // 4. Processar estatísticas
    matchesToProcess.forEach((match) => {
      const { teamA, teamB, scoreA, scoreB } = match;
      if (typeof scoreA === 'number' && typeof scoreB === 'number') {
        const statsA = standings[teamA];
        const statsB = standings[teamB];

        statsA.pj += 1; statsB.pj += 1;
        statsA.gp += scoreA; statsA.gc += scoreB;
        statsB.gp += scoreB; statsB.gc += scoreA;

        if (scoreA > scoreB) {
          statsA.v += 1; statsA.pts += 3; statsB.d += 1;
        } else if (scoreB > scoreA) {
          statsB.v += 1; statsB.pts += 3; statsA.d += 1;
        } else {
          statsA.e += 1; statsA.pts += 1; statsB.e += 1; statsB.pts += 1;
        }
        statsA.sg = statsA.gp - statsA.gc;
        statsB.sg = statsB.gp - statsB.gc;
      }
    });

    // 5. Agrupar e Ordenar
    const groupedResults = {};
    Object.values(standings).forEach((team) => {
      if (!groupedResults[team.group]) groupedResults[team.group] = [];
      groupedResults[team.group].push(team);
    });

    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        return b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.name.localeCompare(b.name);
      });
    }

    // 6. Lógica de Qualificados (Melhores 3ºs da Copa 2026)
    const allThirdPlaces = [];
    for (const groupName in groupedResults) {
      if (groupedResults[groupName][2]) allThirdPlaces.push(groupedResults[groupName][2]);
    }
    allThirdPlaces.sort((a, b) => b.pts - a.pts || b.sg - a.sg || b.gp - a.gp);
    const bestEightThirdsNames = allThirdPlaces.slice(0, 8).map(t => t.name);

    for (const groupName in groupedResults) {
      groupedResults[groupName].forEach((team, index) => {
        if (index < 2 || (index === 2 && bestEightThirdsNames.includes(team.name))) {
          team.qualified = true;
        } else {
          team.qualified = false;
        }
      });
    }

    // 7. Atualizar o cache correto e responder
    if (isLiveRequest) {
      cacheParcial = groupedResults;
      lastCacheParcial = now;
    } else {
      cacheOficial = groupedResults;
      lastCacheOficial = now;
    }

    res.json(groupedResults);

  } catch (error) {
    console.error('Erro na classificação:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
};

module.exports = { getGroupStandings };
