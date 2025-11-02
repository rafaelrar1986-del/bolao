const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  groupMatches: [{
    matchId: {
      type: Number,
      required: true
    },
    bet: {
      type: String,
      required: true,
      enum: ['teamA', 'teamB', 'draw']
    },
    points: {
      type: Number,
      default: 0
    }
  }],
  podium: {
    first: {
      type: String,
      default: null
    },
    second: {
      type: String,
      default: null
    },
    third: {
      type: String,
      default: null
    }
  },
  totalPoints: {
    type: Number,
    default: 0
  },
  // 🔥 NOVO: Controle de envio único
  firstSubmission: {
    type: Date,
    default: null
  },
  hasSubmitted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Bet', betSchema);