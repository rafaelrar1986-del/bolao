const mongoose = require('mongoose');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

/**
 * Guardamos o pódio final em um documento "Setting" (key='podium').
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    podium: {
      first: { type: String },
      second: { type: String },
      third: { type: String },
      fourth: { type: String }
    }
  },
  { timestamps: true }
);

const Setting = mongoose.models.Setting || mongoose.model('Setting', SettingsSchema);

// --------- helpers ---------
function winnerFromScores(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

async function getPodium() {
  const doc = await Setting.findOne({ key: 'podium' }).lean();
  return doc?.podium || null;
}

async function setPodium({ first, second, third, fourth }) {
  const update = {};

  if (first !== undefined) update['podium.first'] = first || null;
  if (second !== undefined) update['podium.second'] = second || null;
  if (third !== undefined) update['podium.third'] = third || null;
  if (fourth !== undefined) update['podium.fourth'] = fourth || null;

  if (Object.keys(update).length === 0) {
    return { ok: true, updated: 0 };
  }

  await Setting.updateOne(
    { key: 'podium' },
    { $set: update },
    { upsert: true }
  );

  const podium = await getPodium();
  if (podium?.first && podium?.second) {
    const result = await recalculateAllPoints();
    return { ok: true, updated: result.updated };
  }

  return { ok: true, updated: 0 };
}

/**
 * Recalcula os pontos de TODOS os bets.
 */
async function recalculateAllPoints() {
  const matches = await Match.find().lean();
  const matchMap = new Map(matches.map(m => [m.matchId, m]));
  const podium = await getPodium();

  const bets = await Bet.find({ hasSubmitted: true });
  let updated = 0;

  for (const bet of bets) {
    let groupPoints = 0;

    for (const gm of bet.groupMatches || []) {
      const m = matchMap.get(gm.matchId);
      
      if (!m || m.status !== 'finished') {
        gm.points = 0;
        gm.qualifierPoints = 0;
        continue;
      }
      
      if (m.phase && !['group', 'knockout'].includes(m.phase)) {
        gm.points = 0;
        gm.qualifierPoints = 0;
        continue;
      }

      const real = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
      const hitResult = real && gm.winner && real === gm.winner;

      const realQualifier = (typeof m.qualifiedSide !== 'undefined' && m.qualifiedSide) ? m.qualifiedSide : real;

      let hitQualifier = false;
      if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
        if (realQualifier && realQualifier !== 'draw' && gm.qualifier === realQualifier) {
          hitQualifier = true;
        }
      }

      // Regra de pontos independentes (1+1)
      gm.points = hitResult ? 1 : 0;
      gm.qualifierPoints = hitQualifier ? 1 : 0;
      
      // Acumula o total da partida para o ranking
      groupPoints += (gm.points + gm.qualifierPoints);
    }

    let podiumPoints = 0;
    if (podium && bet.podium) {
      if (bet.podium.first && bet.podium.first === podium.first) podiumPoints += 7;
      if (bet.podium.second && bet.podium.second === podium.second) podiumPoints += 4;
      if (bet.podium.third && bet.podium.third === podium.third) podiumPoints += 2;
      if (bet.podium.fourth && bet.podium.fourth === podium.fourth) podiumPoints += 2;
    }

    bet.groupPoints = groupPoints;
    bet.podiumPoints = podiumPoints;
    bet.totalPoints = groupPoints + podiumPoints + (bet.bonusPoints || 0);
    bet.lastUpdate = new Date();

    await bet.save();
    updated++;
  }

  return { ok: true, updated };
}

async function resetPodium() {
  await Setting.updateOne(
    { key: 'podium' },
    {
      $set: {
        'podium.first': null,
        'podium.second': null,
        'podium.third': null,
        'podium.fourth': null
      }
    },
    { upsert: true }
  );

  const result = await recalculateAllPoints();
  return { ok: true, updated: result.updated };
}

module.exports = {
  getPodium,
  setPodium,
  recalculateAllPoints,
  resetPodium
};
