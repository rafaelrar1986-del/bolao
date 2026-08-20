// models/Bet.js
const mongoose = require('mongoose');

// 🎯 SUB-SCHEMA: Detalhamento de pontos por regra em uma partida individual
const PointsBreakdownSchema = new mongoose.Schema({
  exactScore: { type: Number, default: 0 },
  scoreTeamA: { type: Number, default: 0 },
  scoreTeamB: { type: Number, default: 0 },
  winner: { type: Number, default: 0 },
  qualifier: { type: Number, default: 0 }
}, { _id: false });

// ⚽ SUB-SCHEMA: Palpite individual em uma partida
const GroupMatchSchema = new mongoose.Schema({
  matchId: {
    type: Number,
    required: true
  },

  scoreA: {
    type: Number,
    default: null
  },

  scoreB: {
    type: Number,
    default: null
  },

  winner: {
    type: String,
    enum: ['A', 'B', 'draw', null],
    default: null
  },

  qualifier: {
    type: String,
    enum: ['A', 'B', null],
    default: null
  },

  points: {
    type: Number,
    default: 0
  },

  pointsBreakdown: {
    type: PointsBreakdownSchema,
    default: () => ({
      exactScore: 0,
      scoreTeamA: 0,
      scoreTeamB: 0,
      winner: 0,
      qualifier: 0
    })
  }

}, { _id: false });

// 🌟 SUB-SCHEMA: Palpites extras do usuário
const ExtrasSchema = new mongoose.Schema({
  topScorer: {
    type: String,
    default: null
  },

  bestAttack: {
    type: String,
    default: null
  },

  worstDefense: {
    type: String,
    default: null
  },

  upset: {
    type: String,
    default: null
  }

}, { _id: false });

// 🏆 SUB-SCHEMA: Breakdown de pontos dos extras
const ExtrasBreakdownSchema = new mongoose.Schema({
  topScorer: {
    type: Number,
    default: 0
  },

  bestAttack: {
    type: Number,
    default: 0
  },

  worstDefense: {
    type: Number,
    default: 0
  },

  upset: {
    type: Number,
    default: 0
  }

}, { _id: false });

// 📋 SCHEMA PRINCIPAL: Aposta / Bolão do Usuário
const BetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true
  },

  leagueId: {
    type: String,
    required: true,
    index: true
  },

  hasSubmitted: {
    type: Boolean,
    default: false
  },

  firstSubmission: {
    type: Date,
    default: null
  },

  lastUpdate: {
    type: Date,
    default: null
  },

  groupMatches: {
    type: [GroupMatchSchema],
    default: []
  },

  podium: {
    type: [String],
    default: []
  },

  extras: {
    type: ExtrasSchema,
    default: () => ({})
  },

  // Totais de Pontos
  totalPoints: {
    type: Number,
    default: 0
  },

  groupPoints: {
    type: Number,
    default: 0
  },

  podiumPoints: {
    type: Number,
    default: 0
  },

  podiumBreakdown: {
    type: [Number],
    default: []
  },

  bonusPoints: {
    type: Number,
    default: 0
  },

  extrasPoints: {
    type: Number,
    default: 0
  },

  extrasBreakdown: {
    type: ExtrasBreakdownSchema,
    default: () => ({
      topScorer: 0,
      bestAttack: 0,
      worstDefense: 0,
      upset: 0
    })
  }

}, { timestamps: true });

// Índice único por usuário e liga
BetSchema.index(
  { user: 1, leagueId: 1 },
  { unique: true }
);

// ============================================================
// MIDDLEWARES
// ============================================================

/**
 * Deriva automaticamente o campo winner
 * a partir dos scores A e B.
 */
BetSchema.pre('save', function (next) {

  if (
    this.groupMatches &&
    this.groupMatches.length > 0
  ) {

    for (const gm of this.groupMatches) {

      const a = gm.scoreA;
      const b = gm.scoreB;

      if (
        typeof a === 'number' &&
        typeof b === 'number'
      ) {

        if (a > b) {
          gm.winner = 'A';

        } else if (b > a) {
          gm.winner = 'B';

        } else {
          gm.winner = 'draw';
        }

      } else if (
        a == null &&
        b == null
      ) {

        gm.winner = null;
      }

      // Se apenas um score estiver preenchido,
      // preserva o winner existente.
    }
  }

  next();
});

/**
 * Deriva winner também em updates
 * via findOneAndUpdate.
 */
BetSchema.pre(
  'findOneAndUpdate',
  function (next) {

    const update =
      this.getUpdate();

    if (
      update &&
      update.$set &&
      update.$set.groupMatches
    ) {

      for (
        const gm
        of update.$set.groupMatches
      ) {

        const a = gm.scoreA;
        const b = gm.scoreB;

        if (
          typeof a === 'number' &&
          typeof b === 'number'
        ) {

          if (a > b) {
            gm.winner = 'A';

          } else if (b > a) {
            gm.winner = 'B';

          } else {
            gm.winner = 'draw';
          }

        } else if (
          a == null &&
          b == null
        ) {

          gm.winner = null;
        }
      }
    }

    next();
  }
);

/**
 * Post-hook defensivo para garantir
 * consistência do winner.
 */
BetSchema.post(
  'findOneAndUpdate',
  async function (doc) {

    if (
      !doc ||
      !doc.groupMatches ||
      doc.groupMatches.length === 0
    ) {
      return;
    }

    let changed = false;

    for (
      const gm
      of doc.groupMatches
    ) {

      const a = gm.scoreA;
      const b = gm.scoreB;

      let expected =
        gm.winner;

      if (
        typeof a === 'number' &&
        typeof b === 'number'
      ) {

        expected =
          a > b
            ? 'A'
            : b > a
              ? 'B'
              : 'draw';

      } else if (
        a == null &&
        b == null
      ) {

        expected = null;
      }

      if (
        gm.winner !== expected
      ) {

        gm.winner =
          expected;

        changed = true;
      }
    }

    if (changed) {

      doc.markModified(
        'groupMatches'
      );

      await doc.save();
    }
  }
);

// ============================================================
// MÉTODOS ESTÁTICOS
// ============================================================

/**
 * Valida se a quantidade de times
 * no pódio não excede o limite.
 */
BetSchema.statics.validatePodiumSize =
  function (podium, podiumSize) {

    const size =
      Number(
        podiumSize ?? 4
      );

    if (!Array.isArray(podium)) {
      return {
        valid: false,
        error:
          'Pódio deve ser um array de strings.'
      };
    }

    if (
      podium.length > size
    ) {
      return {
        valid: false,
        error:
          `Pódio excede o limite de ${size} times permitidos.`
      };
    }

    return {
      valid: true,
      error: null
    };
  };

// ============================================================
// MÉTODO DE INSTÂNCIA
// ============================================================

/**
 * Recalcula os pontos totais da aposta
 * a partir dos subtotais e breakdowns.
 *
 * IMPORTANTE:
 * Todas as somas usam Number() explicitamente
 * para impedir concatenação de strings/objetos.
 */
BetSchema.methods.recalculateTotals =
  function () {

    // ==========================================================
    // 1. PONTOS DAS PARTIDAS
    // ==========================================================
    this.groupPoints =
      (this.groupMatches || [])
        .reduce(
          (sum, m) =>
            sum +
            (
              Number(
                m?.points
              ) || 0
            ),
          0
        );

    // ==========================================================
    // 2. PONTOS DO PÓDIO
    // ==========================================================
    this.podiumPoints =
      (this.podiumBreakdown || [])
        .reduce(
          (sum, value) =>
            sum +
            (
              Number(value) || 0
            ),
          0
        );

    // ==========================================================
    // 3. PONTOS DOS EXTRAS
    // ==========================================================
    const eb =
      this.extrasBreakdown
        ? (
            typeof
              this.extrasBreakdown.toObject
              === 'function'
              ? this.extrasBreakdown.toObject()
              : this.extrasBreakdown
          )
        : {};

    this.extrasPoints =
      (Number(
        eb?.topScorer
      ) || 0) +

      (Number(
        eb?.bestAttack
      ) || 0) +

      (Number(
        eb?.worstDefense
      ) || 0) +

      (Number(
        eb?.upset
      ) || 0);

    // ==========================================================
    // 4. TOTAL GERAL
    // ==========================================================
    this.totalPoints =
      (
        Number(
          this.groupPoints
        ) || 0
      ) +

      (
        Number(
          this.podiumPoints
        ) || 0
      ) +

      (
        Number(
          this.extrasPoints
        ) || 0
      ) +

      (
        Number(
          this.bonusPoints
        ) || 0
      );

    return this;
  };

// ============================================================
// EXPORT
// ============================================================

module.exports =
  mongoose.models.Bet ||
  mongoose.model(
    'Bet',
    BetSchema
  );
