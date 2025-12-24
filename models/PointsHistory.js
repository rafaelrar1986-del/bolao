const mongoose = require('mongoose');

const pointsHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    // 📅 Dia da pontuação (normalizado para 00:00:00)
    date: {
      type: Date,
      required: true,
      index: true
    },

    // 📊 Pontuação total do usuário naquele dia
    points: {
      type: Number,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// 🔒 REGRA ABSOLUTA: 1 registro por usuário por dia
pointsHistorySchema.index(
  { user: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model('PointsHistory', pointsHistorySchema);
