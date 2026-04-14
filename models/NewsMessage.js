// models/NewsMessage.js
const mongoose = require('mongoose');

/* =========================
    Subdocumento de Reação
========================= */
const NewsReactionSchema = new mongoose.Schema(
  {
    emoji: {
      type: String,
      required: true
    },
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ]
  },
  { _id: false }
);

/* =========================
    Mensagem do News
========================= */
const NewsMessageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // 🔑 ID DA LIGA (Garante que as notícias sejam exclusivas de cada campeonato)
    leagueId: {
      type: String,
      required: true,
      index: true
    },

    text: {
      type: String,
      required: true,
      maxlength: 80,
      trim: true
    },

    reactions: {
      type: [NewsReactionSchema],
      default: []
    }
  },
  {
    // Criamos apenas createdAt para o controle do TTL (auto-delete)
    timestamps: { createdAt: true, updatedAt: false }
  }
);

/* =========================
    ⏱️ TTL — APAGA APÓS 6 HORAS
========================= */
// 6 horas = 21600 segundos
// O MongoDB verifica periodicamente e remove documentos onde (now - createdAt) > 21600
NewsMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 21600 }
);

module.exports = mongoose.model('NewsMessage', NewsMessageSchema);
