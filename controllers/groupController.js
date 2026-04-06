const Match = require('../models/Match');

// Variáveis de Cache em memória RAM
let cacheTable = null;
let lastCacheTime = 0;
const CACHE_DURATION = 60000; // 60 segundos

const getGroupStandings = async (req, res) => {
  const now = Date.now();

  // 1. Verificação de Cache
  if (cacheTable && (now - lastCacheTime < CACHE_DURATION)) {
    return res.json(cacheTable);
  }

  try {
    // 2. Busca todos os jogos da fase de grupos
    const allGroupMatches = await Match.find({ phase: 'group' }).lean();

    const standings = {};

    // 3. Inicializar todos os times que existem nos jogos (garante 0 pontos para quem não jogou)
    allGroupMatches.forEach((match) => {
      const { teamA, teamB, group } = match;

      [teamA, teamB].forEach((team) => {
        if (!standings[team]) {
          standings[team] = {
            name: team,
            group: group,
            pj: 0, v: 0, e: 0, d: 0,
            gp: 0, gc: 0, sg: 0, pts: 0,
            qualified: false // Padrão não qualificado
          };
        }
      });
    });

    // 4. Processar jogos que já aconteceram ou estão em andamento
    const activeMatches = allGroupMatches.filter(m => m.status !== 'scheduled');

    activeMatches.forEach((match) => {
      const { teamA, teamB, scoreA, scoreB } = match;

      if (typeof scoreA === 'number' && typeof scoreB === 'number') {
        const statsA = standings[teamA];
        const statsB = standings[teamB];

        statsA.pj += 1;
        statsB.pj += 1;
        statsA.gp += scoreA;
        statsA.gc += scoreB;
        statsB.gp += scoreB;
        statsB.gc += scoreA;

        if (scoreA > scoreB) {
          statsA.v += 1;
          statsA.pts += 3;
          statsB.d += 1;
        } else if (scoreB > scoreA) {
          statsB.v += 1;
          statsB.pts += 3;
          statsA.d += 1;
        } else {
          statsA.e += 1;
          statsA.pts += 1;
          statsB.e += 1;
          statsB.pts += 1;
        }

        statsA.sg = statsA.gp - statsA.gc;
        statsB.sg = statsB.gp - statsB.gc;
      }
    });

    // 5. Agrupar por Letra do Grupo e Ordenar Internamente
    const groupedResults = {};
    Object.values(standings).forEach((team) => {
      if (!groupedResults[team.group]) groupedResults[team.group] = [];
      groupedResults[team.group].push(team);
    });

    // Ordenação básica de cada grupo
    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        return b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.name.localeCompare(b.name);
      });
    }

    // 6. LÓGICA COPA 2026: Identificar os 8 melhores terceiros
    const allThirdPlaces = [];
    for (const groupName in groupedResults) {
      const group = groupedResults[groupName];
      // O time na posição index 2 é o terceiro colocado após a ordenação acima
      if (group[2]) {
        allThirdPlaces.push(group[2]);
      }
    }

    // Ordenar o ranking dos terceiros colocados entre si
    allThirdPlaces.sort((a, b) => {
      return b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.name.localeCompare(b.name);
    });

    // Pegar apenas os nomes dos 8 primeiros desse ranking de terceiros
    const bestEightThirdsNames = allThirdPlaces.slice(0, 8).map(t => t.name);

    // 7. Marcar a propriedade 'qualified' nos times
    for (const groupName in groupedResults) {
      groupedResults[groupName].forEach((team, index) => {
        if (index < 2) {
          // 1º e 2º colocados sempre qualificados
          team.qualified = true;
        } else if (index === 2 && bestEightThirdsNames.includes(team.name)) {
          // 3º colocado qualificado se estiver no TOP 8 dos terceiros
          team.qualified = true;
        } else {
          team.qualified = false;
        }
      });
    }

    // 8. Atualizar Cache e Responder
    cacheTable = groupedResults;
    lastCacheTime = now;

    res.json(groupedResults);

  } catch (error) {
    console.error('Erro ao calcular classificação:', error);
    res.status(500).json({ error: 'Erro interno ao processar tabela de classificação.' });
  }
};

module.exports = { getGroupStandings };
