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

// 🎯 SUB-SCHEMA: Breakdown dos extras avaliados por partida
const MatchExtrasBreakdownSchema = new mongoose.Schema({
  qualifier: {
    type: Number,
    default: 0
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
  },

  // Pontos de extras avaliados por partida (ex.: Classificado).
  // Não entram como categoria separada no ranking; os pontos são agregados
  // ao total de Mata-mata.
  matchExtras: {
    qualifier: {
      type: Number,
      default: 0
    }
  },

  groupQualification: {
    type: Number,
    default: 0
  }

}, { _id: false });

// 🏆 SUB-SCHEMA: Palpite da classificação de um grupo
const GroupPredictionSchema = new mongoose.Schema({
  group: { type: String, required: true, trim: true },
  positions: [{
    position: { type: Number, required: true, min: 1 },
    team: { type: String, required: true, trim: true }
  }],
  additionalQualifiedTeams: {
    type: [String],
    default: []
  },
  points: { type: Number, default: 0 },
  pointsBreakdown: {
    type: [{
      team: String,
      predictedPosition: Number,
      actualPosition: Number,
      predictedQualified: Boolean,
      actualQualified: Boolean,
      points: Number,
      matchedRuleIndex: Number
    }],
    default: []
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

  // Comprovante/auditoria da versão atualmente válida desta aposta.
  currentReceipt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BetReceipt',
    default: null,
    index: true
  },

  currentProtocol: {
    type: String,
    default: null,
    index: true
  },

  groupMatches: {
    type: [GroupMatchSchema],
    default: []
  },

  groupPredictions: {
    type: [GroupPredictionSchema],
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

  groupPredictionPoints: {
    type: Number,
    default: 0
  },

  groupPredictionBreakdown: {
    type: [{
      group: String,
      points: Number
    }],
    default: []
  },

  matchExtrasBreakdown: {
    type: MatchExtrasBreakdownSchema,
    default: () => ({ qualifier: 0 })
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
 * winnerFromScore é uma regra da liga e é validada nas rotas de apostas.
 * O model não deriva winner, permitindo que winnerFromScore=false preserve
 * um vencedor independente do placar.
 */

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
    // 4. PONTOS DA CLASSIFICAÇÃO PARA O MATA-MATA
    // ==========================================================
    this.groupPredictionPoints =
      Number(this.groupPredictionPoints) || 0;

    // 5. TOTAL GERAL
    // ==========================================================
    this.totalPoints =
      (
        Number(this.groupPoints) || 0
      ) +
      (
        Number(this.groupPredictionPoints) || 0
      ) +
      (
        Number(this.podiumPoints) || 0
      ) +
      (
        Number(this.extrasPoints) || 0
      ) +
      (
        Number(this.bonusPoints) || 0
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
