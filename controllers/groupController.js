const Match = require('../models/Match');

const getGroupStandings = async (req, res) => {
  try {
    // 1. Buscamos apenas jogos da fase de grupos que já terminaram (ou estão rolando se quiser tabela em tempo real)
    // Se quiser apenas jogos encerrados, use: { phase: 'group', status: 'finished' }
    // Para tabela "Live", use: { phase: 'group', status: { $ne: 'scheduled' } }
    const matches = await Match.find({ 
      phase: 'group', 
      status: { $ne: 'scheduled' } 
    }).lean();

    const standings = {};

    matches.forEach((match) => {
      const { teamA, teamB, scoreA, scoreB, group } = match;

      // Inicializa os times no objeto se não existirem
      [teamA, teamB].forEach((team) => {
        if (!standings[team]) {
          standings[team] = {
            name: team,
            group: group,
            pj: 0, // Partidas Jogadas
            v: 0,  // Vitórias
            e: 0,  // Empates
            d: 0,  // Derrotas
            gp: 0, // Gols Pró
            gc: 0, // Gols Contra
            sg: 0, // Saldo de Gols
            pts: 0 // Pontos
          };
        }
      });

      // Só calcula se houver placar (evita erros com null)
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

    // 2. Agrupar por letra do grupo e ordenar
    const groupedResults = {};

    Object.values(standings).forEach((team) => {
      if (!groupedResults[team.group]) {
        groupedResults[team.group] = [];
      }
      groupedResults[team.group].push(team);
    });

    // Ordenar cada grupo por Pontos -> Saldo de Gols -> Gols Pró
    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        return b.pts - a.pts || b.sg - a.sg || b.gp - a.gp;
      });
    }

    res.json(groupedResults);
  } catch (error) {
    console.error('Erro ao calcular classificação:', error);
    res.status(500).json({ error: 'Erro interno ao processar tabela.' });
  }
};

module.exports = { getGroupStandings };
