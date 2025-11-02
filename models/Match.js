const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  matchId: {
    type: Number,
    required: true,
    unique: true
  },
  teamA: {
    type: String,
    required: true
  },
  teamB: {
    type: String,
    required: true
  },
  date: {
    type: String,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  group: {
    type: String,
    required: true
  },
  winner: {
    type: String,
    enum: ['teamA', 'teamB', 'draw'], // Só pode ser um desses valores
    default: null
  },
  scoreA: {
    type: Number,
    default: null
  },
  scoreB: {
    type: Number,
    default: null
  },
  isFinished: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Match', matchSchema);