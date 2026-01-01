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
    timestamps: { createdAt: true, updatedAt: false }
  }
);

module.exports = mongoose.model('NewsMessage', NewsMessageSchema);
