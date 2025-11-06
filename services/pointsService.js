// services/pointsService.js
const Bet = require('../models/Bet');
const Match = require('../models/Match');

/**
 * Determina vencedor a partir do placar.
 * @param {number} a 
 * @param {number} b 
 * @returns {'A' | 'B' | 'draw'}
 */
function winnerFromScore(a, b) {
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

/**
 * Recalcula os pontos de jogos (fase de grupos) para TODAS as apostas,
 * usando as partidas já finalizadas. Mantém podiumPoints/bonusPoints como estão.
 * totalPoints = groupPoints + podiumPoints + bonusPoints
 */
async function recalcGroupPointsFromFinishedMatches() {
  // mapa matchId -> winner
  const finished = await Match.find({ status: 'finished' }).lean();
  const winners = new Map(
    finished.map(m => [m.matchId, winnerFromScore(Number(m.scoreA), Number(m.scoreB))])
  );

  // Itera todas as apostas
  const cursor = Bet.find({ hasSubmitted: true }).cursor();
  let updated = 0;

  for await (const bet of cursor) {
    // atualiza points de cada jogo
    bet.groupMatches = (bet.groupMatches || []).map(gm => {
      const w = winners.get(gm.matchId);
      if (w) {
        gm.points = (gm.winner === w) ? 1 : 0;
      } else {
        // se não finalizado, não pontua
        gm.points = 0;
      }
      return gm;
    });

    // soma groupPoints e totalPoints
    bet.groupPoints = (bet.groupMatches || []).reduce((sum, gm) => sum + (gm.points || 0), 0);
    bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);

    await bet.save();
    updated++;
  }

  return updated;
}

/**
 * Processa o pódio final informado pelo admin e recalcula os pontos de pódio
 * para TODAS as apostas, seguindo: 1º=7 pts, 2º=4 pts, 3º=2 pts.
 * Depois atualiza totalPoints.
 * @param {{first:string, second:string, third:string}} podium
 */
async function processPodiumForAllBets(podium) {
  const { first, second, third } = podium || {};
  if (!first || !second || !third) {
    throw new Error('Pódio incompleto. Informe first, second e third.');
  }

  const cursor = Bet.find({ hasSubmitted: true }).cursor();
  let updated = 0;

  for await (const bet of cursor) {
    let pts = 0;
    // comparação simples por string (time)
    if (bet.podium?.first && bet.podium.first === first) pts += 7;
    if (bet.podium?.second && bet.podium.second === second) pts += 4;
    if (bet.podium?.third && bet.podium.third === third) pts += 2;

    bet.podiumPoints = pts;
    bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
    await bet.save();
    updated++;
  }

  return updated;
}

/**
 * Checagem simples de integridade: contagens e partidas finalizadas vs. pendentes.
 */
async function integrityOverview() {
  const totalBets = await Bet.countDocuments({ hasSubmitted: true });
  const totalUsersWithBet = (await Bet.distinct('user', { hasSubmitted: true })).length;
  const totalMatches = await Match.countDocuments({});
  const finishedMatches = await Match.countDocuments({ status: 'finished' });

  return {
    totalBets,
    totalUsersWithBet,
    totalMatches,
    finishedMatches,
    pendingMatches: Math.max(0, totalMatches - finishedMatches),
    errors: [],   // espaço para regras adicionais de integridade
    warnings: []  // idem
  };
}

module.exports = {
  recalcGroupPointsFromFinishedMatches,
  processPodiumForAllBets,
  integrityOverview,
};
