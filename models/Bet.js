// models/Bet.js
const mongoose = require('mongoose');

const GroupMatchSchema = new mongoose.Schema({
  matchId: { type: Number, required: true },
  // 'A' | 'B' | 'draw'
  winner: {
    type: String,
    enum: ['A', 'B', 'draw'],
    required: true
  },
  // quem o usuário marcou como classificado (apenas em mata-mata): 'A' | 'B'
  qualifier: {
    type: String,
    enum: ['A', 'B', null],
    default: null
  },
  // pontos individuais da partida
  points: { type: Number, default: 0 },
  qualifierPoints: { type: Number, default: 0 }
}, { _id: false });

const PodiumSchema = new mongoose.Schema({
  first:  { type: String, default: null },
  second: { type: String, default: null },
  third:  { type: String, default: null },
  fourth: { type: String, default: null }
}, { _id: false });

const BetSchema = new mongoose.Schema({
  // Referência ao usuário - removido unique:true para permitir múltiplas ligas
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  
  // 🔑 ID DA LIGA (Essencial para o filtro de histórico e ranking)
  leagueId: { type: String, required: true, index: true },

  hasSubmitted: { type: Boolean, default: false },
  firstSubmission: { type: Date, default: null },
  lastUpdate: { type: Date, default: null },

  groupMatches: { type: [GroupMatchSchema], default: [] },
  podium: { type: PodiumSchema, default: {} },

  // Totais (Mantidos exatamente como no seu original)
  totalPoints: { type: Number, default: 0 },
  groupPoints: { type: Number, default: 0 },
  podiumPoints: { type: Number, default: 0 },
  bonusPoints: { type: Number, default: 0 }
}, { timestamps: true });

// 🔒 ÍNDICE COMPOSTO: Garante 1 aposta única por usuário PARA CADA LIGA.
BetSchema.index({ user: 1, leagueId: 1 }, { unique: true });

module.exports = mongoose.model('Bet', BetSchema);
