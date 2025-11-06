const mongoose = require('mongoose');

// -------------------------
// Helpers de pontuação/labels
// -------------------------
function outcomeFromScore(a, b) {
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; // draw
}

function outcomeFromBetString(scoreStr) {
  // Aceita "1-0", "0-1", "0-0" (formato atual do front)
  // e também "A", "B", "D" (se quiser salvar assim no futuro)
  if (!scoreStr) return null;
  if (scoreStr === 'A' || scoreStr === 'B' || scoreStr === 'D') return scoreStr;

  const m = String(scoreStr).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return outcomeFromScore(a, b);
}

function betChoiceLabel(betStr, teamA, teamB) {
  const out = outcomeFromBetString(betStr);
  if (out === 'A') return teamA;
  if (out === 'B') return teamB;
  if (out === 'D') return 'Empate';
  return betStr || '-';
}

// Pontos do pódio (regra nova)
const PODIUM_POINTS = { first: 7, second: 4, third: 2 };

// -------------------------
// Schema
// -------------------------
const groupMatchSchema = new mongoose.Schema(
  {
    matchId: { type: Number, required: true },
    // Palpite salvo no formato "1-0", "0-0", "0-1" (front atual)
    bet: { type: String, required: true },
    // Mantemos estes campos por compatibilidade, mas não contam para a regra nova
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    // Pontos conquistados neste jogo (0 ou 1, conforme acerto do vencedor/empate)
    points: { type: Number, default: 0 },
  },
  { _id: false }
);

const betSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // JOGOS DE GRUPO
    groupMatches: { type: [groupMatchSchema], default: [] },

    // PÓDIO
    podium: {
      first: { type: String, default: '' },
      second: { type: String, default: '' },
      third: { type: String, default: '' },
    },

    // SOMATÓRIOS
    totalPoints: { type: Number, default: 0 },  // group + podium + bonus
    groupPoints: { type: Number, default: 0 },
    podiumPoints: { type: Number, default: 0 },
    bonusPoints: { type: Number, default: 0 },

    // CONTROLE
    hasSubmitted: { type: Boolean, default: false },
    firstSubmission: { type: Date, default: null },
    lastUpdate: { type: Date, default: null },
    isCalculated: { type: Boolean, default: false },

    // Ranking
    rankingPosition: { type: Number, default: null },
  },
  { timestamps: true }
);

// -------------------------
// Métodos de instância
// -------------------------

// Calcula e grava pontos de UMA partida finalizada
// matchArg: objeto/Doc de Match com { matchId, scoreA, scoreB, status, teamA, teamB }
// Retorna { updated, points, previousPoints }
betSchema.methods.calculatePointsForMatch = async function (matchId, matchArg) {
  const match = matchArg;
  if (!match || match.status !== 'finished') {
    return { updated: false, points: 0, previousPoints: 0 };
  }

  const gm = (this.groupMatches || []).find((m) => m.matchId === Number(matchId));
  if (!gm) return { updated: false, points: 0, previousPoints: 0 };

  const previousPoints = gm.points || 0;

  const realOutcome = outcomeFromScore(match.scoreA, match.scoreB);
  const betOutcome = outcomeFromBetString(gm.bet);
  const points = betOutcome && realOutcome && betOutcome === realOutcome ? 1 : 0;

  gm.points = points;

  // Recalcular somatórios
  this.groupPoints = (this.groupMatches || []).reduce((s, x) => s + (x.points || 0), 0);
  this.totalPoints = (this.groupPoints || 0) + (this.podiumPoints || 0) + (this.bonusPoints || 0);
  this.isCalculated = true;

  await this.save();

  return { updated: points !== previousPoints, points, previousPoints };
};

// Recalcula pontos deste usuário para um conjunto de partidas finalizadas
// matches: array de Match(s) finalizadas
// actualPodium (opcional): { first, second, third }
betSchema.methods.calculatePoints = async function (matches = [], actualPodium = null) {
  const finished = matches.filter((m) => m && m.status === 'finished');
  const byId = new Map(finished.map((m) => [m.matchId, m]));

  (this.groupMatches || []).forEach((gm) => {
    const m = byId.get(gm.matchId);
    if (!m) return;
    const realOutcome = outcomeFromScore(m.scoreA, m.scoreB);
    const betOutcome = outcomeFromBetString(gm.bet);
    gm.points = betOutcome && betOutcome === realOutcome ? 1 : 0;
  });

  this.groupPoints = (this.groupMatches || []).reduce((s, x) => s + (x.points || 0), 0);

  if (actualPodium) {
    let pp = 0;
    if (this.podium?.first === actualPodium.first) pp += PODIUM_POINTS.first;
    if (this.podium?.second === actualPodium.second) pp += PODIUM_POINTS.second;
    if (this.podium?.third === actualPodium.third) pp += PODIUM_POINTS.third;
    this.podiumPoints = pp;
  }

  this.totalPoints = (this.groupPoints || 0) + (this.podiumPoints || 0) + (this.bonusPoints || 0);
  this.isCalculated = true;

  await this.save();

  return {
    totalPoints: this.totalPoints,
    groupPoints: this.groupPoints,
    podiumPoints: this.podiumPoints || 0,
  };
};

// Simula (não salva) pontos considerando partidas finalizadas e pódio opcional
betSchema.methods.simulatePoints = function (matches = [], podium = null) {
  const finished = matches.filter((m) => m && m.status === 'finished');
  const byId = new Map(finished.map((m) => [m.matchId, m]));

  let groupPoints = 0;
  let correctBets = 0;

  (this.groupMatches || []).forEach((gm) => {
    const m = byId.get(gm.matchId);
    if (!m) return;
    const realOutcome = outcomeFromScore(m.scoreA, m.scoreB);
    const betOutcome = outcomeFromBetString(gm.bet);
    const hit = betOutcome && betOutcome === realOutcome;
    if (hit) {
      groupPoints += 1;
      correctBets += 1;
    }
  });

  let podiumPoints = 0;
  if (podium) {
    if (this.podium?.first === podium.first) podiumPoints += PODIUM_POINTS.first;
    if (this.podium?.second === podium.second) podiumPoints += PODIUM_POINTS.second;
    if (this.podium?.third === podium.third) podiumPoints += PODIUM_POINTS.third;
  }

  const totalPoints = groupPoints + podiumPoints + (this.bonusPoints || 0);

  return {
    totalPoints,
    groupPoints,
    podiumPoints,
    correctBets,
    totalMatches: finished.length,
  };
};

// -------------------------
// Métodos estáticos
// -------------------------

// Recalcula todos os pontos (de todos os usuários)
betSchema.statics.recalculateAllPoints = async function (matches = [], podium = null) {
  const Bet = this;
  const finished = matches.filter((m) => m && m.status === 'finished');
  const bets = await Bet.find({ hasSubmitted: true });

  let updatedBets = 0;
  let updatedItems = 0;

  for (const b of bets) {
    const before = b.totalPoints || 0;
    await b.calculatePoints(finished, podium);
    const after = b.totalPoints || 0;
    if (before !== after) updatedBets += 1;
    updatedItems += (b.groupMatches?.length || 0);
  }

  return {
    totalBets: bets.length,
    updatedBets,
    updatedItems,
  };
};

// Atualiza rankingPosition com base em totalPoints (maior para menor)
betSchema.statics.updateRanking = async function () {
  const Bet = this;
  const bets = await Bet.find({ hasSubmitted: true })
    .select('_id totalPoints lastUpdate')
    .sort({ totalPoints: -1, lastUpdate: 1 })
    .lean();

  const bulk = bets.map((b, idx) => ({
    updateOne: {
      filter: { _id: b._id },
      update: { $set: { rankingPosition: idx + 1 } },
    },
  }));

  if (bulk.length) {
    const r = await Bet.bulkWrite(bulk);
    return r.modifiedCount || bulk.length;
  }
  return 0;
};

// Estatísticas globais para PointsService.getPointsStatistics()
betSchema.statics.getGlobalStats = async function () {
  const Bet = this;

  const [agg] = await Bet.aggregate([
    { $match: { hasSubmitted: true } },
    {
      $group: {
        _id: null,
        totalParticipants: { $sum: 1 },
        totalPoints: { $sum: '$totalPoints' },
        avgGroupPoints: { $avg: '$groupPoints' },
        averagePoints: { $avg: '$totalPoints' },
        maxPoints: { $max: '$totalPoints' },
      },
    },
  ]);

  return {
    totalParticipants: agg?.totalParticipants || 0,
    totalPoints: agg?.totalPoints || 0,
    avgGroupPoints: agg?.avgGroupPoints || 0,
    averagePoints: agg?.averagePoints || 0,
    pointsStats: {
      maxPoints: agg?.maxPoints || 0,
    },
  };
};

// Top participantes (para o painel de stats)
betSchema.statics.getTopParticipants = async function (limit = 10) {
  const Bet = this;
  const list = await Bet.find({ hasSubmitted: true })
    .populate('user', 'name')
    .select('user totalPoints rankingPosition')
    .sort({ totalPoints: -1, lastUpdate: 1 })
    .limit(limit)
    .lean();

  return list.map((b) => ({
    user: b.user,
    totalPoints: b.totalPoints || 0,
    rankingPosition: b.rankingPosition || null,
  }));
};

// Reset geral (apenas dev) — zera pontos e flags
betSchema.statics.resetAllCalculations = async function () {
  const Bet = this;
  const r = await Bet.updateMany(
    {},
    {
      $set: {
        'groupMatches.$[].points': 0,
        groupPoints: 0,
        podiumPoints: 0,
        bonusPoints: 0,
        totalPoints: 0,
        isCalculated: false,
        rankingPosition: null,
      },
    }
  );
  return r.modifiedCount || 0;
};

module.exports = mongoose.model('Bet', betSchema);
