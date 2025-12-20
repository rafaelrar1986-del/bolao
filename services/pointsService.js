// services/pointsService.js
const mongoose = require('mongoose');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

/**
 * Guardamos o pódio final em um documento "Setting" (key='podium')
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
   PODIUM
===================== */

async function setPodium({ first, second, third, fourth }) {
  await Setting.updateOne(
    { key: 'podium' },
    { $set: { podium: { first, second, third, fourth } } },
    { upsert: true }
  );

  // Recalcula pontos SEM ZERAR jogos não finalizados
  const result = await recalculateAllPoints();
  return { ok: true, updated: result.updated };
}

async function resetPodium() {
  await Setting.updateOne(
    { key: 'podium' },
    { $unset: { podium: '' } },
    { upsert: true }
  );

  const result = await recalculateAllPoints();
  return { ok: true, updated: result.updated };
}

/* =====================
   RECALCULAR PONTOS
===================== */

async function recalculateAllPoints() {
  const matches = await Match.find().lean();
  const matchMap = new Map(matches.map(m => [m.matchId, m]));
  const podium = await getPodium();

  const bets = await Bet.find({ hasSubmitted: true });
  let updated = 0;

  for (const bet of bets) {
    let groupPoints = 0;

    /* ===== GRUPOS + MATA-MATA ===== */
    for (const gm of bet.groupMatches || []) {
      const m = matchMap.get(gm.matchId);

      // 🚫 NÃO zera pontos se o jogo ainda não terminou
      if (!m || m.status !== 'finished') {
        // mantém pontuação existente
        if (typeof gm.points !== 'number') gm.points = 0;
        if (typeof gm.qualifierPoints !== 'number') gm.qualifierPoints = 0;
        groupPoints += gm.points || 0;
        continue;
      }

      // segurança futura
      if (m.phase && !['group', 'knockout'].includes(m.phase)) {
        groupPoints += gm.points || 0;
        continue;
      }

      const realWinner = winnerFromScores(
        Number(m.scoreA),
        Number(m.scoreB)
      );

      const hitResult =
        realWinner &&
        gm.winner &&
        realWinner === gm.winner;

      // qualificado (penaltis / desempate)
      const realQualifier =
        typeof m.qualifiedSide !== 'undefined' && m.qualifiedSide
          ? m.qualifiedSide
          : realWinner;

      let hitQualifier = false;
      if (
        gm.qualifier &&
        (gm.qualifier === 'A' || gm.qualifier === 'B') &&
        realQualifier &&
        realQualifier !== 'draw' &&
        gm.qualifier === realQualifier
      ) {
        hitQualifier = true;
      }

      gm.qualifierPoints = hitQualifier ? 1 : 0;
      gm.points = (hitResult ? 1 : 0) + gm.qualifierPoints;

      groupPoints += gm.points;
    }

    /* ===== PODIUM ===== */
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
      groupPoints + podiumPoints + (bet.bonusPoints || 0);

    bet.lastUpdate = new Date();

    await bet.save();
    updated++;
  }

  return { ok: true, updated };
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
