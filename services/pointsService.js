// services/pointsService.js
const mongoose = require('mongoose');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

/**
 * Guardamos o pódio final em um documento "Setting" vinculado a cada liga.
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true }, // 'podium'
    leagueId: { type: Number, required: true, index: true }, // 👈 Vincula o pódio à liga
    podium: {
      first: { type: String },
      second: { type: String },
      third: { type: String },
      fourth: { type: String }
    }
  },
  { timestamps: true }
);

// Índice único para garantir apenas um pódio por liga
SettingsSchema.index({ key: 1, leagueId: 1 }, { unique: true });

const Setting = mongoose.models.Setting || mongoose.model('Setting', SettingsSchema);

// --------- helpers ---------
function winnerFromScores(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

async function getPodium(leagueId) {
  if (!leagueId) return null;
  const doc = await Setting.findOne({ key: 'podium', leagueId: Number(leagueId) }).lean();
  return doc?.podium || null;
}

async function setPodium(leagueId, { first, second, third, fourth }) {
  if (!leagueId) throw new Error("leagueId é obrigatório para definir o pódio");

  const update = {};
  if (first !== undefined) update['podium.first'] = first || null;
  if (second !== undefined) update['podium.second'] = second || null;
  if (third !== undefined) update['podium.third'] = third || null;
  if (fourth !== undefined) update['podium.fourth'] = fourth || null;

  if (Object.keys(update).length === 0) {
    return { ok: true, updated: 0 };
  }

  await Setting.updateOne(
    { key: 'podium', leagueId: Number(leagueId) },
    { $set: update },
    { upsert: true }
  );

  // Só recalcula se os principais postos forem definidos
  const podium = await getPodium(leagueId);
  if (podium?.first) {
    const result = await recalculateAllPoints(leagueId);
    return { ok: true, updated: result.updated };
  }

  return { ok: true, updated: 0 };
}

/**
 * Recalcula os pontos de TODOS os bets de uma LIGA específica.
 */
async function recalculateAllPoints(leagueId) {
  if (!leagueId) throw new Error("leagueId é obrigatório para recalcular pontos");

  // 1. Busca apenas partidas e pódio da liga em questão
  const matches = await Match.find({ leagueId: Number(leagueId) }).lean();
  const matchMap = new Map(matches.map(m => [m.matchId, m]));
  const podium = await getPodium(leagueId);

  // 2. Busca apenas apostas desta liga
  const bets = await Bet.find({ leagueId: Number(leagueId), hasSubmitted: true });
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

      // Validação de fase (group ou knockout)
      if (m.phase && !['group', 'knockout'].includes(m.phase)) {
        gm.points = 0;
        gm.qualifierPoints = 0;
        continue;
      }

      const real = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
      const hitResult = real && gm.winner && real === gm.winner;

      // Lógica de qualificado (para empates em mata-mata)
      const realQualifier = (m.qualifiedSide) ? m.qualifiedSide : real;

      let hitQualifier = false;
      if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
        if (realQualifier && realQualifier !== 'draw' && gm.qualifier === realQualifier) {
          hitQualifier = true;
        }
      }

      gm.points = hitResult ? 1 : 0;
      gm.qualifierPoints = hitQualifier ? 1 : 0;
      groupPoints += (gm.points + gm.qualifierPoints);
    }

    // ---- Pontos de Pódio ----
    let podiumPoints = 0;
    if (podium && bet.podium) {
      if (bet.podium.first && bet.podium.first === podium.first) podiumPoints += 7;
      if (bet.podium.second && bet.podium.second === podium.second) podiumPoints += 4;
      if (bet.podium.third && bet.podium.third === podium.third) podiumPoints += 2;
      if (bet.podium.fourth && bet.podium.fourth === podium.fourth) podiumPoints += 2;
    }

    // Atualização dos campos do documento Bet
    bet.groupPoints = groupPoints;
    bet.podiumPoints = podiumPoints;
    bet.totalPoints = groupPoints + podiumPoints + (bet.bonusPoints || 0);
    bet.lastUpdate = new Date();

    await bet.save();
    updated++;
  }

  return { ok: true, updated };
}

async function resetPodium(leagueId) {
  if (!leagueId) return { ok: false, message: "leagueId ausente" };

  await Setting.updateOne(
    { key: 'podium', leagueId: Number(leagueId) },
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

  const result = await recalculateAllPoints(leagueId);
  return { ok: true, updated: result.updated };
}

module.exports = {
  getPodium,
  setPodium,
  recalculateAllPoints,
  resetPodium
};
