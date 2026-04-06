const Match = require('../models/Match');

const getGroupStandings = async (req, res) => {
  try {
    // 1. Buscamos TODOS os jogos da fase de grupos (incluindo 'scheduled')
    const allGroupMatches = await Match.find({ phase: 'group' }).lean();

    const standings = {};

    // 2. Primeiro passo: Inicializar TODOS os times que existem na tabela de jogos
    allGroupMatches.forEach((match) => {
      const { teamA, teamB, group } = match;

      [teamA, teamB].forEach((team) => {
        if (!standings[team]) {
          standings[team] = {
            name: team,
            group: group,
            pj: 0, v: 0, e: 0, d: 0,
            gp: 0, gc: 0, sg: 0, pts: 0
          };
        }
      });
    });

    // 3. Segundo passo: Processar apenas os jogos que JÁ TIVERAM gols (parciais ou finais)
    const activeMatches = allGroupMatches.filter(m => m.status !== 'scheduled');

    activeMatches.forEach((match) => {
      const { teamA, teamB, scoreA, scoreB } = match;

      if (scoreA !== null && scoreB !== null) {
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

    // 4. Agrupar por letra e ordenar
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

    res.json(groupedResults);
  } catch (error) {
    console.error('Erro ao calcular classificação:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
};
