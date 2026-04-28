const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Status Detalhados (Baseados na API):
 * - 'scheduled'    (Agendado - NS)
 * - '1_tempo'      (Em andamento - 1H)
 * - 'intervalo'    (Pausa - HT)
 * - '2_tempo'      (Em andamento - 2H)
 * - 'prorrogacao'  (Tempo Extra - ET)
 * - 'penaltis'     (Disputa de Penais - P)
 * - 'finished'     (Finalizado - FT, AET, PEN)
 * - 'cancelled'    (Cancelado)
 * - 'postponed'    (Adiado)
 */

const MatchSchema = new Schema(
  {
    // ID Único da partida (ID da API para evitar duplicidade)
    matchId: { type: Number, required: true, unique: false, index: true },

    // IDENTIFICAÇÃO DA LIGA
    leagueId: { type: Number, required: false, index: true }, 
    leagueName: { type: String, default: '' },

    phaseName: { 
      type: String, 
      required: false, 
      trim: true 
    },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    // Logos dos times (URLs da API/CDN)
    logoA: { type: String, default: '' },
    logoB: { type: String, default: '' },

    group: { type: String, required: true, trim: true }, // Ex: "Grupo A" ou "Rodada 1"
    phase: { type: String, enum: ['group', 'knockout', 'mata-mata'], default: 'group', index: true },

    // Definido automaticamente pelo middleware para mata-mata
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

    // --- ABA 1: EVENTOS COMPLETOS (CRONOLOGIA) ---
    // Substitui a lógica de apenas gols por todos os incidentes
    goalsDetail: [
      {
        type: { type: String },         // goal, card, substitution, var
        name: { type: String },         // Nome do jogador
        min: { type: Number },          // Minuto
        extra: { type: Number },        // Acréscimo (ex: 45+2)
        side: { type: String, enum: ['home', 'away'] },
        description: { type: String },  // Ex: "Yellow Card", "Penalty"
        playerIn: { type: String },     // Para trocas
        playerOut: { type: String }     // Para trocas
      }
    ],

    // --- ABA 1: POSSE DE BOLA ---
    possession: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 }
    },

    // --- ABA 2: ESTATÍSTICAS DETALHADAS ---
    statistics: { type: Array, default: [] },

    // --- ABA 3: ESCALAÇÕES ---
    lineups: {
      home: { type: Object, default: {} },
      away: { type: Object, default: {} }
    },

    // Dados de tempo real da API
    apiStatus: { type: String, default: 'NS' }, 
    minute: { type: String, default: '' },      
    
    // Controle para não processar pontos repetidos no bolão
    processed: { type: Boolean, default: false }, 

    betsCount: { type: Number, default: 0 },
   apiId: {
      type: Number,
      required: true,  // Agora ele é obrigatório para o robô funcionar bem
      unique: true,    // Garante que não existam jogos repetidos
      index: true      // Velocidade máxima na busca do Updater
    },
  },
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);

// ---------- Middlewares (A Lógica Automática) ----------

MatchSchema.pre('save', function (next) {
  // Garante que arrays e objetos complexos sejam marcados como modificados
  if (this.isModified('goalsDetail')) this.markModified('goalsDetail');
  if (this.isModified('statistics')) this.markModified('statistics');
  if (this.isModified('lineups')) this.markModified('lineups');

  const isKnockout = this.phase === 'knockout' || this.phase === 'mata-mata';
  
  if (this.status === 'finished' && isKnockout) {
    // 1. Prioridade: Pênaltis
    if (this.penaltiesA !== null && this.penaltiesB !== null) {
      if (this.penaltiesA > this.penaltiesB) this.qualifiedSide = 'A';
      else if (this.penaltiesB > this.penaltiesA) this.qualifiedSide = 'B';
    } 
    // 2. Prioridade: Gols
    else if (this.scoreA !== null && this.scoreB !== null) {
      if (this.scoreA > this.scoreB) this.qualifiedSide = 'A';
      else if (this.scoreB > this.scoreA) this.qualifiedSide = 'B';
    }
  }
  next();
});

// ---------- Virtuals ----------

MatchSchema.virtual('isFinished').get(function () {
  return this.status === 'finished';
});

MatchSchema.virtual('isLive').get(function () {
  const liveStatus = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', 'penaltis'];
  return liveStatus.includes(this.status);
});

MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  
  const a = typeof this.scoreA === 'number' ? this.scoreA : null;
  const b = typeof this.scoreB === 'number' ? this.scoreB : null;
  
  if (a === null || b === null) return null;
  
  if (this.penaltiesA !== null && this.penaltiesB !== null) {
      if (this.penaltiesA === this.penaltiesB) return 'D';
      return this.penaltiesA > this.penaltiesB ? 'A' : 'B';
  }

  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; // Empate
});

// ---------- Métodos Estáticos ----------

MatchSchema.statics.getByLeague = function (leagueId) {
  return this.find({ leagueId: Number(leagueId) }).sort({ date: 1, time: 1 });
};

MatchSchema.statics.finishMatch = async function (matchId, scoreA, scoreB, penA = null, penB = null) {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  match.scoreA = Number(scoreA);
  match.scoreB = Number(scoreB);
  match.penaltiesA = penA !== null ? Number(penA) : null;
  match.penaltiesB = penB !== null ? Number(penB) : null;
  match.status = 'finished';
  match.minute = "Fim";

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
  match.qualifiedSide = null;
  match.minute = "";
  match.processed = false;
  match.goalsDetail = [];
  match.statistics = [];
  match.lineups = { home: {}, away: {} };

  await match.save();
  return match;
};

MatchSchema.index({ leagueId: 1, group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);
