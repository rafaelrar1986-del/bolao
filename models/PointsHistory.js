// models/PointsHistory.js
const mongoose = require('mongoose');

const pointsHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    // 🔑 ID DA LIGA (Essencial para filtrar o gráfico por campeonato)
    leagueId: {
      type: String,
      required: true,
      index: true
    },

    // 📅 Dia da pontuação (normalizado para 00:00:00 UTC)
    date: {
      type: Date,
      required: true,
      index: true
    },

    // 📊 Pontuação total acumulada do usuário naquele dia
    points: {
      type: Number,
      required: true
    },

    // 📊 Componentes acumulados usados pelo ranking esportivo e desempates
    exactScorePoints: { type: Number, default: 0 },
    podiumPoints: { type: Number, default: 0 },
    extraPoints: { type: Number, default: 0 },
    knockoutPoints: { type: Number, default: 0 },

    // 🏅 Posição do usuário no ranking naquele dia (opcional, mas ótimo para o gráfico de linha de posição)
    position: {
      type: Number
    }
  },
  {
    timestamps: true
  }
);

/**
 * 🔒 REGRA ABSOLUTA ATUALIZADA:
 * 1 registro por usuário, por dia, POR LIGA.
 * Isso permite que o usuário participe de vários campeonatos simultâneos.
 */
pointsHistorySchema.index(
  { user: 1, date: 1, leagueId: 1 },
  { unique: true }
);

// Consultas de linha do tempo por liga são muito frequentes.
// Mantém a busca ordenada por liga/data eficiente.
pointsHistorySchema.index({ leagueId: 1, date: 1, points: -1 });

module.exports = mongoose.model('PointsHistory', pointsHistorySchema);
