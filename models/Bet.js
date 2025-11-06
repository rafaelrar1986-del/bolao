// models/Bet.js
const mongoose = require('mongoose');

const GroupMatchSchema = new mongoose.Schema({
  matchId: { type: Number, required: true },
  // novo formato: 'A' | 'B' | 'draw'
  winner: {
    type: String,
    enum: ['A', 'B', 'draw'],
    required: true
  },
  // pontos do jogo (1 por acerto; 0 caso contrário)
  points: { type: Number, default: 0 }
}, { _id: false });

const PodiumSchema = new mongoose.Schema({
  first: { type: String, required: true },   // Campeão
  second: { type: String, required: true },  // Vice
  third: { type: String, required: true }    // Terceiro
}, { _id: false });

const BetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, unique: true },
  hasSubmitted: { type: Boolean, default: false },
  firstSubmission: { type: Date, default: null },
  lastUpdate: { type: Date, default: null },

  groupMatches: { type: [GroupMatchSchema], default: [] },
  podium: { type: PodiumSchema, required: true },

  // totais (mantemos para ranking)
  totalPoints: { type: Number, default: 0 },
  groupPoints: { type: Number, default: 0 },
  podiumPoints: { type: Number, default: 0 },
  bonusPoints: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Bet', BetSchema);
