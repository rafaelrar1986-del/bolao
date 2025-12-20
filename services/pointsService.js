// services/pointsService.js
const mongoose = require('mongoose');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

/**
 * Settings (key-value) para armazenar pódio
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    podium: {
      first: String,
      second: String,
      third: String,
      fourth: String
    }
  },
  { timestamps: true }
);

const Setting =
  mongoose.models.Setting ||
  mongoose.model('Setting', SettingsSchema);

/* =====================
   HELPERS
===================== */
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

/* =====================
   RECALCULA SOMENTE PÓDIO
===================== */
async function recalculatePodiumPointsOnly() {
  const podium = await getPodium();
  if (!podium) return { ok: true, updated: 0 };

  const bets = await Bet.find({ hasSubmitted: true });
  let updated = 0;

  for (const bet of bets) {
    let podiumPoints = 0;

    if (bet.podium) {
      if (bet.podium.first === podium.first) podiumPoints += 7;
      if (bet.podium.second === podium.second) podiumPoints += 4;
      if (bet.podium.third === podium.third) podiumPoints += 2;
      if (bet.podium.fourth === podium.fourth) podiumPoints += 2;
    }

    bet.podiumPoints = podiumPoints;

    // 🔒 NÃO mexe nos pontos já conquistados
    bet.totalPoints =
      (bet.groupPoints || 0) +
      podiumPoints +
      (bet.bonusPoints || 0);

    bet.lastUpdate = new Date();
    await bet.save();
    updated++;
  }

  return { ok: true, updated };
}

/* =====================
   RECALCULA TUDO (JOGOS)
===================== */
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

      const realQualifier =
        m.qualifiedSide || real;

      let hitQualifier = false;
      if (gm.qualifier && realQualifier && realQualifier !== 'draw') {
        hitQualifier = gm.qualifier === realQualifier;
      }

      gm.qualifierPoints = hitQualifier ? 1 : 0;
      gm.points = (hitResult ? 1 : 0) + gm.qualifierPoints;
      groupPoints += gm.points;
    }

    // -------- PÓDIO --------
    let podiumPoints = 0;
    if (podium && bet.podium) {
      if (bet.podium.first === podium.first) podiumPoints += 7;
      if (bet.podium.second === podium.second) podiumPoints += 4;
      if (bet.podium.third === podium.third) podiumPoints += 2;
      if (bet.podium.fourth === podium.fourth) podiumPoints += 2;
    }

    bet.groupPoints = groupPoints;
    bet.podiumPoints = podiumPoints;
    bet.totalPoints =
      groupPoints +
      podiumPoints +
      (bet.bonusPoints || 0);

    bet.lastUpdate = new Date();
    await bet.save();
    updated++;
  }

  return { ok: true, updated };
}

/* =====================
   SET / RESET PODIUM
===================== */
async function setPodium({ first, second, third, fourth }) {
  await Setting.updateOne(
    { key: 'podium' },
    { $set: { podium: { first, second, third, fourth } } },
    { upsert: true }
  );

  // 🔥 NÃO recalcula jogos
  return recalculatePodiumPointsOnly();
}

async function resetPodium() {
  await Setting.updateOne(
    { key: 'podium' },
    { $unset: { podium: '' } },
    { upsert: true }
  );

  return recalculatePodiumPointsOnly();
}

/* =====================
   EXPORTS
===================== */
module.exports = {
  getPodium,
  setPodium,
  resetPodium,
  recalculateAllPoints
};
