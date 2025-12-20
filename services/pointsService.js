// services/betService.js
const Bet = require('../models/Bet');

/**
 * 🔒 FUNÇÃO CRÍTICA
 * Mescla novos palpites SEM apagar pontos já calculados
 */
function mergeGroupMatches(oldMatches = [], newMatches = []) {
  const oldMap = new Map(
    oldMatches.map(m => [String(m.matchId), m])
  );

  return newMatches.map(nm => {
    const old = oldMap.get(String(nm.matchId));

    return {
      ...nm,

      // 🔥 preserva pontos existentes
      points: old?.points ?? 0,
      qualifierPoints: old?.qualifierPoints ?? 0
    };
  });
}

/**
 * Salva aposta do usuário (fase de grupos + mata-mata + pódio)
 * ❗ NÃO recalcula pontos
 */
async function saveBet({ userId, payload }) {
  let bet = await Bet.findOne({ userId });

  if (!bet) {
    bet = new Bet({
      userId,
      groupMatches: [],
      podium: {},
      bonusPoints: 0,
      groupPoints: 0,
      podiumPoints: 0,
      totalPoints: 0,
      hasSubmitted: false
    });
  }

  /* =====================
     GROUP + KNOCKOUT
  ===================== */
  if (Array.isArray(payload.groupMatches)) {
    bet.groupMatches = mergeGroupMatches(
      bet.groupMatches,
      payload.groupMatches
    );
  }

  /* =====================
     PODIUM
  ===================== */
  if (payload.podium) {
    bet.podium = {
      first: payload.podium.first || null,
      second: payload.podium.second || null,
      third: payload.podium.third || null,
      fourth: payload.podium.fourth || null
    };
  }

  /* =====================
     FLAGS
  ===================== */
  if (typeof payload.hasSubmitted === 'boolean') {
    bet.hasSubmitted = payload.hasSubmitted;
  }

  bet.lastUpdate = new Date();

  // 🔒 NÃO MEXE EM:
  // bet.groupPoints
  // bet.podiumPoints
  // bet.totalPoints

  await bet.save();
  return bet;
}

module.exports = {
  saveBet
};
