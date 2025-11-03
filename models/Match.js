const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  matchId: {
    type: Number,
    required: [true, 'ID do jogo é obrigatório'],
    unique: true,
    index: true,
    min: [1, 'ID do jogo deve ser maior que 0']
  },
  teamA: {
    type: String,  // ✅ STRING SIMPLES
    required: [true, 'Time A é obrigatório'],
    trim: true,
    maxlength: [50, 'Nome do time não pode exceder 50 caracteres']
  },
  teamB: {
    type: String,  // ✅ STRING SIMPLES
    required: [true, 'Time B é obrigatório'],
    trim: true,
    maxlength: [50, 'Nome do time não pode exceder 50 caracteres']
  },
  date: {
    type: String,
    required: [true, 'Data do jogo é obrigatória'],
    match: [/^\d{2}\/\d{2}\/\d{4}$/, 'Formato de data inválido. Use DD/MM/YYYY']
  },
  time: {
    type: String,
    required: [true, 'Horário do jogo é obrigatório'],
    match: [/^\d{2}:\d{2}$/, 'Formato de horário inválido. Use HH:MM']
  },
  group: {
    type: String,  // ✅ STRING SIMPLES
    required: [true, 'Grupo é obrigatório'],
    trim: true
  },
  stadium: {
    type: String,  // ✅ STRING SIMPLES
    trim: true,
    maxlength: [100, 'Nome do estádio não pode exceder 100 caracteres'],
    default: 'A definir'
  },
  status: {
    type: String,  // ✅ STRING SIMPLES
    default: 'scheduled'
  },
  winner: {
    type: String,  // ✅ STRING SIMPLES
    default: null
  },
  scoreA: {
    type: Number,
    min: [0, 'Placar não pode ser negativo'],
    max: [20, 'Placar muito alto'],
    default: null
  },
  scoreB: {
    type: Number,
    min: [0, 'Placar não pode ser negativo'],
    max: [20, 'Placar muito alto'],
    default: null
  },
  isFinished: {
    type: Boolean,
    default: false
  },
  datetime: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ... (resto do código do Match.js permanece igual)

module.exports = mongoose.model('Match', matchSchema);
