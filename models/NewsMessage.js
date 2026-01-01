const mongoose = require('mongoose');

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

    /* =========================
       😀 REAÇÕES
       Ex:
       reactions: [
         { emoji: "😂", users: [userId1, userId2] },
         { emoji: "🔥", users: [userId3] }
       ]
    ========================= */
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
