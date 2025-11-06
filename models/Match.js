const mongoose = require('mongoose');
const { Schema } = mongoose;

// -------- Helpers --------
function getWinner(scoreA, scoreB) {
  if (scoreA > scoreB) return 'A';
  if (scoreB > scoreA) return 'B';
  return 'D'; // draw
}

function podiumPointsFor(actual, pick) {
  let pts = 0;
  if (!actual || !pick) return 0;
  if (actual.first && pick.first && actual.first === pick.first) pts += 7;
  if (actual.second && pick.second && actual.second === pick.second) pts += 4;
  if (actual.third && pick.third && actual.third === pick.third) pts += 2;
  return pts;
}

const GroupMatchSchema = new Schema(
  {
    matchId: { type: Number, required: true },
    // pick: "A" (teamA), "B" (teamB), "D" (empate)
    pick: { type: String, enum: ['A', 'B', 'D'], required: true },
    points: { type: Number, default: 0 }, // 0 ou 1
  },
  { _id: false }
);

const PodiumSchema = new Schema(
  {
    first: { type: String, default: '' },
    second: { type: String, default: '' },
    third: { type: String, default: '' },
  },
  { _id: false }
);

const BetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', unique: true, index: true },

    hasSubmitted: { type: Boolean, default: false },
    firstSubmission: { type: Date, default: null },
    lastUpdate: { type: Date, default: null },

    groupMatches: { type: [GroupMatchSchema], default: [] },
    podium: { type: PodiumSchema, default: () => ({}) },

    groupPoints: { type: Number, default: 0 },
    podiumPoints: { type: Number, default: 0 },
    bonusPoints: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },

    rankingPosition: { type: Number, default: null },
    isCalculated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// -------- Instance: calcular pontos de UM jogo e salvar --------
BetSchema.methods.calculatePointsForMatch = async function (matchId, matchDoc) {
  // Encontrar palpite do jogo
  const gm = this.groupMatches.find((g) => g.matchId === Number(matchId));
  if (!gm) {
    return { updated: false, points: 0, previousPoints: 0 };
  }

  const previousPoints = gm.points || 0;

  // Só pontua se finalizado
  if (!matchDoc || matchDoc.status !== 'finished') {
    gm.points = 0;
  } else {
    const realWinner = getWinner(matchDoc.scoreA, matchDoc.scoreB); // 'A', 'B' ou 'D'
    gm.points = gm.pick === realWinner ? 1 : 0;
  }

  // recomputa groupPoints
  this.groupPoints = this.groupMatches.reduce((sum, g) => sum + (g.points || 0), 0);

  // total = grupos + pódio + bônus
  this.totalPoints = (this.groupPoints || 0) + (this.podiumPoints || 0) + (this.bonusPoints || 0);
  this.isCalculated = true;

  await this.save();

  return {
    updated: previousPoints !== gm.points,
    points: gm.points,
    previousPoints,
  };
};

// -------- Static: recalcular TUDO para todos os usuários --------
BetSchema.statics.recalculateAllPoints = async function (finishedMatches = null, actualPodium = null) {
  const Match = mongoose.model('Match');

  // Buscar partidas finalizadas caso não venha como argumento
  let matches = finishedMatches;
  if (!matches) {
    matches = await Match.find({ status: 'finished' }).lean();
  } else if (!Array.isArray(matches)) {
    // Caso tenha vindo objeto errado
    matches = await Match.find({ status: 'finished' }).lean();
  }

  const byId = new Map(matches.map((m) => [Number(m.matchId), m]));

  const all = await this.find({ hasSubmitted: true }).exec();
  let updatedBets = 0;
  let updatedItems = 0;

  for (const bet of all) {
    // Zera pontos dos jogos e recalcula
    bet.groupMatches = bet.groupMatches.map((g) => {
      const m = byId.get(Number(g.matchId));
      let pts = 0;
      if (m && m.status === 'finished') {
        const real = getWinner(m.scoreA, m.scoreB);
        pts = g.pick === real ? 1 : 0;
      }
      if (g.points !== pts) updatedItems++;
      return { ...g.toObject?.() ?? g, points: pts };
    });

    bet.groupPoints = bet.groupMatches.reduce((sum, g) => sum + (g.points || 0), 0);

    // Pódio
    if (actualPodium) {
      bet.podiumPoints = podiumPointsFor(actualPodium, bet.podium);
    } else {
      // se nenhum pódio enviado, manter o que já houver (ou zera)
      // A prática mais segura aqui é recalcular apenas quando informado:
      // então não altera bet.podiumPoints se não for fornecido actualPodium.
      bet.podiumPoints = bet.podiumPoints || 0;
    }

    bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
    bet.isCalculated = true;
    await bet.save();
    updatedBets++;
  }

  return {
    success: true,
    totalBets: all.length,
    updatedBets,
    updatedItems,
  };
};

// -------- Static: atualizar ranking (posição) --------
BetSchema.statics.updateRanking = async function () {
  const docs = await this.find({ hasSubmitted: true })
    .sort({ totalPoints: -1, lastUpdate: 1, _id: 1 })
    .select('_id totalPoints lastUpdate')
    .exec();

  let position = 1;
  for (const d of docs) {
    await this.updateOne({ _id: d._id }, { $set: { rankingPosition: position } });
    position++;
  }
  return docs.length;
};

// -------- Static: stats globais --------
BetSchema.statics.getGlobalStats = async function () {
  const pipeline = [
    { $match: { hasSubmitted: true } },
    {
      $group: {
        _id: null,
        totalParticipants: { $sum: 1 },
        totalPoints: { $sum: '$totalPoints' },
        averagePoints: { $avg: '$totalPoints' },
        avgGroupPoints: { $avg: '$groupPoints' },
        maxPoints: { $max: '$totalPoints' },
      },
    },
  ];

  const result = await this.aggregate(pipeline);
  if (!result.length) {
    return {
      totalParticipants: 0,
      totalPoints: 0,
      averagePoints: 0,
      avgGroupPoints: 0,
      pointsStats: { maxPoints: 0 },
    };
  }
  const r = result[0];
  return {
    totalParticipants: r.totalParticipants || 0,
    totalPoints: r.totalPoints || 0,
    averagePoints: Math.round((r.averagePoints || 0) * 100) / 100,
    avgGroupPoints: r.avgGroupPoints || 0,
    pointsStats: { maxPoints: r.maxPoints || 0 },
  };
};

// -------- Static: top participantes --------
BetSchema.statics.getTopParticipants = async function (limit = 10) {
  return this.find({ hasSubmitted: true })
    .populate('user', 'name email')
    .sort({ totalPoints: -1, lastUpdate: 1 })
    .limit(limit)
    .exec();
};

// -------- Instance: simulação (sem salvar) --------
BetSchema.methods.simulatePoints = function (matches = [], podium = null) {
  // matches: array de { matchId, scoreA, scoreB, status } (ou usar as existentes)
  const byId = new Map(matches.map((m) => [Number(m.matchId), m]));
  let group = 0;
  let correctBets = 0;
  let totalMatches = 0;

  for (const g of this.groupMatches) {
    const m = byId.get(Number(g.matchId));
    if (!m || m.status !== 'finished') continue;
    totalMatches++;
    const real = getWinner(m.scoreA, m.scoreB);
    const pts = g.pick === real ? 1 : 0;
    group += pts;
    if (pts) correctBets++;
  }

  const podiumPts = podium ? podiumPointsFor(podium, this.podium) : 0;

  return {
    totalPoints: group + podiumPts + (this.bonusPoints || 0),
    groupPoints: group,
    podiumPoints: podiumPts,
    correctBets,
    totalMatches,
  };
};

// -------- Static: reset geral de cálculos (dev) --------
BetSchema.statics.resetAllCalculations = async function () {
  const res = await this.updateMany(
    {},
    {
      $set: {
        groupMatches: [],
        podium: { first: '', second: '', third: '' },
        groupPoints: 0,
        podiumPoints: 0,
        bonusPoints: 0,
        totalPoints: 0,
        hasSubmitted: false,
        firstSubmission: null,
        lastUpdate: null,
        isCalculated: false,
        rankingPosition: null,
      },
    }
  );
  return res.modifiedCount || 0;
};

module.exports = mongoose.models.Bet || mongoose.model('Bet', BetSchema);
