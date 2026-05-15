const mongoose = require('mongoose');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Setting = require('../models/Settings');

// --------- helpers ---------
function winnerFromScores(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

/**
 * Busca as configurações de pódio de todas as ligas
 * Retorna um Map: leagueId -> podium object
 */
async function getAllPodiumsMap() {
  const docs = await Setting.find({ key: 'podium' }).lean();
  const map = new Map();
  docs.forEach(d => {
    map.set(Number(d.leagueId), d.podium || null);
  });
  return map;
}

async function getPodium(leagueId) {
  if (!leagueId) return null;
  const doc = await Setting.findOne({ key: 'podium', leagueId: Number(leagueId) }).lean();
  return doc?.podium || null;
}

/**
 * Define o pódio e dispara o recálculo global
 */
async function setPodium(leagueId, { first, second, third, fourth }) {
  if (!leagueId) throw new Error("leagueId é obrigatório para definir o pódio");

  const update = {};
  if (first !== undefined) update['podium.first'] = first || null;
  if (second !== undefined) update['podium.second'] = second || null;
  if (third !== undefined) update['podium.third'] = third || null;
  if (fourth !== undefined) update['podium.fourth'] = fourth || null;

  if (Object.keys(update).length === 0) return { ok: true, updated: 0 };

  await Setting.updateOne(
    { key: 'podium', leagueId: Number(leagueId) },
    { $set: update },
    { upsert: true }
  );

  // Recalcula TUDO para garantir que a mudança reflita em todos os usuários
  const result = await recalculateAllPoints();
  return { ok: true, updated: result.updated };
}

/**
 * RECALCULO GLOBAL: Processa todos os palpites de todas as ligas.
 * Ideal para rodar via backend após fim de jogos ou definição de pódio.
 */
async function recalculateAllPoints() {
  // 1. Carrega dados de referência globais
  const [matches, podiumsMap] = await Promise.all([
    Match.find({}).lean(),
    getAllPodiumsMap()
  ]);

  const matchMap = new Map(matches.map(m => [m.matchId, m]));
  
  // 2. Busca todas as apostas submetidas (independente de liga)
  const bets = await Bet.find({ hasSubmitted: true });
  let updated = 0;

  for (const bet of bets) {
    let groupPoints = 0;
    const currentLeagueId = Number(bet.leagueId);

    // --- Pontos por Partida ---
    for (const gm of bet.groupMatches || []) {
      const m = matchMap.get(gm.matchId);
      
      if (!m || m.status !== 'finished') {
        gm.points = 0;
        gm.qualifierPoints = 0;
        continue;
      }

      const realWinner = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
      const hitResult = realWinner && gm.winner && realWinner === gm.winner;

      // Qualificado (Mata-mata)
      const realQualifier = m.qualifiedSide || realWinner;
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

    // --- Pontos de Pódio (Cruzando com a liga da Bet) ---
    let podiumPoints = 0;
    const leaguePodium = podiumsMap.get(currentLeagueId);

    if (leaguePodium && bet.podium) {
      if (bet.podium.first && bet.podium.first === leaguePodium.first) podiumPoints += 7;
      if (bet.podium.second && bet.podium.second === leaguePodium.second) podiumPoints += 5;
      if (bet.podium.third && bet.podium.third === leaguePodium.third) podiumPoints += 4;
      if (bet.podium.fourth && bet.podium.fourth === leaguePodium.fourth) podiumPoints += 3;
    }

    // --- Persistência dos Resultados ---
    bet.groupPoints = groupPoints;
    bet.podiumPoints = podiumPoints;
    bet.totalPoints = groupPoints + podiumPoints + (bet.bonusPoints || 0);
    bet.lastUpdate = new Date();

    // MarkModified é necessário se groupMatches for um Mixed Type no Schema
    bet.markModified('groupMatches'); 
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

  const result = await recalculateAllPoints();
  return { ok: true, updated: result.updated };
}

module.exports = {
  getPodium,
  setPodium,
  recalculateAllPoints,
  resetPodium
};
