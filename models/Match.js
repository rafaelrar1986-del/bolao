const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Status Detalhados (Baseados na API BSD):
 * - 'scheduled'   (Agendado - NS)
 * - '1_tempo'     (Em andamento - 1H)
 * - 'intervalo'   (Pausa - HT)
 * - '2_tempo'     (Em andamento - 2H)
 * - 'prorrogacao' (Tempo Extra - ET)
 * - 'penaltis'    (Disputa de Penais - P)
 * - 'finished'    (Finalizado - FT, AET, PEN)
 * - 'cancelled'   (Cancelado)
 * - 'postponed'   (Adiado)
 */

const MatchSchema = new Schema(
  {
    matchId: { type: Number, required: true, unique: true, index: true },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    group: { type: String, required: true, trim: true },
    phase: { type: String, enum: ['group', 'knockout'], default: 'group', index: true },

    qualifiedSide: { type: String, enum: ['A', 'B', null], default: null },
    stadium: { type: String, default: '', trim: true },

    date: { type: String, required: true, trim: true }, // "DD/MM/AAAA"
    time: { type: String, required: true, trim: true }, // "HH:MM"

    status: {
      type: String,
      enum: [
        'scheduled', 
        '1_tempo', 
        'intervalo', 
        '2_tempo', 
        'prorrogacao', 
        'penaltis', 
        'finished', 
        'cancelled', 
        'postponed'
      ],
      default: 'scheduled',
      index: true,
    },

    scoreA: { type: Number, default: null, min: 0 },
    scoreB: { type: Number, default: null, min: 0 },

    // Placar específico para disputa de pênaltis (Mata-mata)
    penaltiesA: { type: Number, default: null },
    penaltiesB: { type: Number, default: null },

    // Dados de tempo real da API
    apiStatus: { type: String, default: 'NS' }, 
    minute: { type: String, default: '' },      
    
    // Controle para não processar pontos repetidos no bolão
    processed: { type: Boolean, default: false }, 

    betsCount: { type: Number, default: 0 },
    apiId: {
      type: Number,
      required: false,
      index: true,
      sparse: true
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ---------- Virtuals ----------
MatchSchema.virtual('isFinished').get(function () {
  return this.status === 'finished';
});

// Verifica se o jogo está rolando (em qualquer uma das etapas)
MatchSchema.virtual('isLive').get(function () {
  return ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', 'penaltis'].includes(this.status);
});

MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  
  const a = typeof this.scoreA === 'number' ? this.scoreA : null;
  const b = typeof this.scoreB === 'number' ? this.scoreB : null;
  
  if (a === null || b === null) return null;
  
  // Se terminou nos pênaltis, o vencedor vem do placar de penais
  if (this.penaltiesA !== null && this.penaltiesB !== null) {
      return this.penaltiesA > this.penaltiesB ? 'A' : 'B';
  }

  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; // draw
});

// ---------- Métodos Estáticos ----------
MatchSchema.statics.finishMatch = async function (matchId, scoreA, scoreB, penA = null, penB = null) {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  match.scoreA = Number(scoreA);
  match.scoreB = Number(scoreB);
  match.penaltiesA = penA !== null ? Number(penA) : null;
  match.penaltiesB = penB !== null ? Number(penB) : null;
  match.status = 'finished';

  await match.save();
  return match;
};

MatchSchema.statics.unfinishMatch = async function (matchId, statusBack = 'scheduled') {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  match.status = statusBack; 
  match.scoreA = null;
  match.scoreB = null;
  match.penaltiesA = null;
  match.penaltiesB = null;
  match.processed = false;

  await match.save();
  return match;
};

MatchSchema.index({ group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);
