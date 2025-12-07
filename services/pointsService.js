// services/pointsService.js
const mongoose = require('mongoose');
const Bet = require('../models/Bet');
const Match = require('../models/Match');

/**
 * Guardamos o pódio final em um documento "Setting" (key='podium').
 * Isso evita criar várias coleções diferentes e funciona como um key-value.
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    podium: {
      first: { type: String },
      second: { type: String },
      third: { type: String }
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

async function setPodium({ first, second, third }) {
  await Setting.updateOne(
    { key: 'podium' },
    { $set: { podium: { first, second, third } } },
    { upsert: true }
  );
  // Após definir pódio, já recalculamos todos os pontos:
  const result = await recalculateAllPoints();
  return { ok: true, updated: result.updated };
}

/**
 * Recalcula os pontos de TODOS os bets.
 * Regras:
 * - Fase de grupos: 1 ponto por acerto de vencedor/empate (A/B/draw) em jogos FINALIZADOS.
 * - Pódio: 7/4/2 pontos para 1º/2º/3º se acertar exatamente o time.
 * - totalPoints = groupPoints + podiumPoints + (bonusPoints || 0)
 */
async function recalculateAllPoints() {
  const matches = await Match.find().lean();
  const matchMap = new Map(matches.map(m => [m.matchId, m]));
  const podium = await getPodium();

  const bets = await Bet.find({ hasSubmitted: true });
  let updated = 0;

  for (const bet of bets) {
    // ---- pontos de grupos (inclui mata-mata)
    let groupPoints = 0;

    for (const gm of bet.groupMatches || []) {
      const m = matchMap.get(gm.matchId);
                 // considera jogos de fase de grupos e mata-mata igualmente: se o jogo existe e foi finalizado, conta.
      if (!m || m.status !== 'finished') {
        // jogo não finalizado -> não conta
        gm.points = 0;
        gm.qualifierPoints = 0;
        continue;
      }
      // Apenas contabilizamos se a partida for de 'group' ou 'knockout' (futuro-proof).
      if (m.phase && !['group','knockout'].includes(m.phase)) {
        gm.points = 0;
        gm.qualifierPoints = 0;
        continue;
      }

      const isKnockout = (m.phase === 'knockout');

      const real = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
      const hitResult = real && gm.winner && real === gm.winner;

      let hitQualifier = false;
      if (isKnockout && gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
        // No nosso modelo, o classificado é o mesmo vencedor do jogo (sem pênaltis separados)
        if (real && real !== 'draw' && gm.qualifier === real) {
          hitQualifier = true;
        }
      }

      gm.qualifierPoints = hitQualifier ? 1 : 0;
      gm.points = (hitResult ? 1 : 0) + (hitQualifier ? 1 : 0);
      groupPoints += gm.points;
    }

    // ---- pódio
    let podiumPoints = 0;
    if (podium && bet.podium) {
      if (bet.podium.first && bet.podium.first === podium.first) podiumPoints += 7;
      if (bet.podium.second && bet.podium.second === podium.second) podiumPoints += 4;
      if (bet.podium.third && bet.podium.third === podium.third) podiumPoints += 2;
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

module.exports = {
  getPodium,
  setPodium,
  recalculateAllPoints
};
