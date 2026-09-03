'use strict';

/**
 * Constrói a artilharia de uma liga exclusivamente a partir dos gols reais
 * persistidos em Match.goalsDetail.
 *
 * Regras:
 * - somente eventos do tipo "goal" contam;
 * - gol contra não é atribuído ao jogador que aparece no incidente;
 * - eventos sem nome de jogador não entram na artilharia;
 * - o lado home/away resolve a seleção e sua logo a partir da partida;
 * - nomes são normalizados apenas para AGRUPAMENTO, preservando o nome exibido.
 */

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlayerKey(value) {
  return normalizeText(value);
}

function isOwnGoal(goal) {
  const type = normalizeText(goal?.type).replace(/_/g, '-');
  if (type === 'own-goal' || type === 'own goal' || type === 'owngoal' || type === 'autogol') {
    return true;
  }

  const description = normalizeText(goal?.description);
  return [
    'own goal',
    'own-goal',
    'gol contra',
    'gol-contra',
    'autogol'
  ].some(marker => description.includes(marker));
}

function isGoalEvent(goal) {
  if (!goal || typeof goal !== 'object') return false;
  const type = normalizeText(goal.type).replace(/_/g, '-');

  // O updater atual grava gols como type=goal. Mantemos apenas esse tipo
  // para não transformar cartões, substituições ou eventos de timeline em gol.
  return type === 'goal' && !isOwnGoal(goal);
}

function getGoalTeam(match, goal) {
  if (goal?.side === 'home') {
    return { name: String(match.teamA || '').trim(), logoUrl: String(match.logoA || '').trim() };
  }
  if (goal?.side === 'away') {
    return { name: String(match.teamB || '').trim(), logoUrl: String(match.logoB || '').trim() };
  }
  return { name: '', logoUrl: '' };
}


function isMatchEligibleForTopScorers(match, mode = 'official') {
  const normalizedMode = String(mode || 'official').trim().toLowerCase();
  const status = String(match?.status || '').trim().toLowerCase();

  if (normalizedMode === 'official') return status === 'finished';
  if (normalizedMode === 'live') {
    return !['scheduled', 'cancelled', 'postponed'].includes(status);
  }
  return false;
}

function filterMatchesForTopScorers(matches, mode = 'official') {
  if (mode !== 'official' && mode !== 'live') return [];
  return (Array.isArray(matches) ? matches : []).filter(match =>
    isMatchEligibleForTopScorers(match, mode)
  );
}

function buildTopScorers(matches, options = {}) {
  const includeGoalDetails = options.includeGoalDetails === true;
  const scorers = new Map();
  let goalsConsidered = 0;
  let ownGoalsExcluded = 0;
  let unnamedGoalsExcluded = 0;

  for (const match of Array.isArray(matches) ? matches : []) {
    if (!Array.isArray(match?.goalsDetail)) continue;

    for (const goal of match.goalsDetail) {
      if (!goal) continue;

      // Contabilizamos o gol contra mesmo quando o updater/legado grava
      // o evento com type=own-goal em vez de type=goal.
      if (isOwnGoal(goal)) {
        ownGoalsExcluded += 1;
        continue;
      }

      if (normalizeText(goal.type) !== 'goal') continue;

      const playerName = String(goal.name || goal.player || '').trim();
      if (!playerName || normalizeText(playerName) === 'lance') {
        unnamedGoalsExcluded += 1;
        continue;
      }

      const playerKey = normalizePlayerKey(playerName);
      if (!playerKey) {
        unnamedGoalsExcluded += 1;
        continue;
      }

      const team = getGoalTeam(match, goal);
      const existing = scorers.get(playerKey) || {
        playerKey,
        player: playerName,
        goals: 0,
        team: team.name || null,
        logoUrl: team.logoUrl || null,
        teams: new Map(),
        goalDetails: []
      };

      existing.goals += 1;

      if (team.name) {
        const teamKey = normalizeText(team.name);
        const currentTeam = existing.teams.get(teamKey) || {
          team: team.name,
          logoUrl: team.logoUrl || null,
          goals: 0
        };
        currentTeam.goals += 1;
        if (!currentTeam.logoUrl && team.logoUrl) currentTeam.logoUrl = team.logoUrl;
        existing.teams.set(teamKey, currentTeam);

        // Para o caso raro de um jogador aparecer por mais de uma seleção,
        // a equipe principal é a que possui mais gols; empate mantém a primeira.
        const rankedTeams = [...existing.teams.values()].sort((a, b) => b.goals - a.goals);
        existing.team = rankedTeams[0]?.team || existing.team;
        existing.logoUrl = rankedTeams[0]?.logoUrl || existing.logoUrl;
      }

      if (includeGoalDetails) {
        existing.goalDetails.push({
          matchId: match.matchId,
          team: team.name || null,
          logoUrl: team.logoUrl || null,
          minute: Number.isFinite(Number(goal.min)) ? Number(goal.min) : null,
          extra: Number.isFinite(Number(goal.extra)) ? Number(goal.extra) : null,
          type: goal.type
        });
      }

      scorers.set(playerKey, existing);
      goalsConsidered += 1;
    }
  }

  const sorted = [...scorers.values()]
    .map(item => ({
      ...item,
      teams: [...item.teams.values()],
      ...(includeGoalDetails ? { goalDetails: item.goalDetails } : {})
    }))
    .sort((a, b) =>
      b.goals - a.goals ||
      normalizeText(a.player).localeCompare(normalizeText(b.player), 'pt-BR')
    );

  // Posições esportivas: jogadores empatados em gols recebem a mesma posição.
  let previousGoals = null;
  let previousPosition = 0;
  const data = sorted.map((item, index) => {
    const position = item.goals === previousGoals ? previousPosition : index + 1;
    previousGoals = item.goals;
    previousPosition = position;

    return {
      position,
      player: item.player,
      goals: item.goals,
      team: item.team,
      logoUrl: item.logoUrl,
      teams: item.teams,
      ...(includeGoalDetails ? { goalDetails: item.goalDetails } : {})
    };
  });

  return {
    data,
    meta: {
      matchesConsidered: Array.isArray(matches) ? matches.length : 0,
      goalsConsidered,
      ownGoalsExcluded,
      unnamedGoalsExcluded,
      scorerCount: data.length
    }
  };
}

module.exports = {
  normalizeText,
  normalizePlayerKey,
  isOwnGoal,
  isGoalEvent,
  getGoalTeam,
  isMatchEligibleForTopScorers,
  filterMatchesForTopScorers,
  buildTopScorers
};
