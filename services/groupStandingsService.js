
'use strict';

/**
 * Fonte única da verdade para classificação de grupos.
 *
 * Ordem:
 * 1. Pontos
 * 2. Confronto direto - pontos
 * 3. Confronto direto - saldo
 * 4. Confronto direto - gols marcados
 * 5. Saldo geral
 * 6. Gols marcados
 * 7. Nome
 *
 * O chamador deve fornecer apenas partidas que participam da classificação.
 * A função é pura e não acessa banco.
 */

function compareTeams(a, b, activeMatches) {
  if (b.pts !== a.pts) return b.pts - a.pts;

  const h2hMatches = activeMatches.filter(m =>
    (m.teamA === a.name && m.teamB === b.name) ||
    (m.teamA === b.name && m.teamB === a.name)
  );

  let h2hPtsA = 0, h2hPtsB = 0;
  let h2hSgA = 0, h2hSgB = 0;
  let h2hGpA = 0, h2hGpB = 0;

  h2hMatches.forEach(m => {
    if (typeof m.scoreA !== 'number' || typeof m.scoreB !== 'number') return;

    const golsA = m.teamA === a.name ? m.scoreA : m.scoreB;
    const golsB = m.teamA === b.name ? m.scoreA : m.scoreB;

    h2hGpA += golsA;
    h2hGpB += golsB;
    h2hSgA += golsA - golsB;
    h2hSgB += golsB - golsA;

    if (golsA > golsB) h2hPtsA += 3;
    else if (golsB > golsA) h2hPtsB += 3;
    else {
      h2hPtsA += 1;
      h2hPtsB += 1;
    }
  });

  if (h2hPtsB !== h2hPtsA) return h2hPtsB - h2hPtsA;
  if (h2hSgB !== h2hSgA) return h2hSgB - h2hSgA;
  if (h2hGpB !== h2hGpA) return h2hGpB - h2hGpA;
  if (b.sg !== a.sg) return b.sg - a.sg;
  if (b.gp !== a.gp) return b.gp - a.gp;

  return a.name.localeCompare(b.name);
}

function calculateGroupStandings(matches = [], teamSourceMatches = matches) {
  const standings = {};

  // A tabela deve existir mesmo quando nenhuma partida foi finalizada.
  // `matches` contém as partidas usadas para pontuar; `teamSourceMatches`
  // contém todas as partidas da fase e serve somente para descobrir os times/grupos.
  (teamSourceMatches || matches).forEach(m => {
    [m.teamA, m.teamB].forEach(team => {
      if (team && !standings[team]) {
        standings[team] = {
          name: team,
          group: m.group,
          pj: 0,
          v: 0,
          e: 0,
          d: 0,
          gp: 0,
          gc: 0,
          sg: 0,
          pts: 0,
          qualified: false
        };
      }
    });
  });

  matches.forEach(m => {
    [m.teamA, m.teamB].forEach(team => {
      if (team && !standings[team]) {
        standings[team] = {
          name: team,
          group: m.group,
          pj: 0,
          v: 0,
          e: 0,
          d: 0,
          gp: 0,
          gc: 0,
          sg: 0,
          pts: 0,
          qualified: false
        };
      }
    });
  });

  matches.forEach(m => {
    const { teamA, teamB, scoreA, scoreB } = m;

    if (typeof scoreA !== 'number' || typeof scoreB !== 'number') return;

    const sA = standings[teamA];
    const sB = standings[teamB];
    if (!sA || !sB) return;

    sA.pj++;
    sB.pj++;
    sA.gp += scoreA;
    sA.gc += scoreB;
    sB.gp += scoreB;
    sB.gc += scoreA;

    if (scoreA > scoreB) {
      sA.v++;
      sA.pts += 3;
      sB.d++;
    } else if (scoreB > scoreA) {
      sB.v++;
      sB.pts += 3;
      sA.d++;
    } else {
      sA.e++;
      sA.pts++;
      sB.e++;
      sB.pts++;
    }

    sA.sg = sA.gp - sA.gc;
    sB.sg = sB.gp - sB.gc;
  });

  const groupedResults = {};
  Object.values(standings).forEach(team => {
    if (!groupedResults[team.group]) groupedResults[team.group] = [];
    groupedResults[team.group].push(team);
  });

  Object.keys(groupedResults).forEach(group => {
    groupedResults[group].sort((a, b) => compareTeams(a, b, matches));
  });

  return groupedResults;
}

module.exports = {
  compareTeams,
  calculateGroupStandings
};
