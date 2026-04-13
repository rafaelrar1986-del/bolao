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

    // IDENTIFICAÇÃO DA LIGA (O segredo para separar os campeonatos)
    leagueId: { type: Number, required: true, index: true }, 
    leagueName: { type: String, default: '' },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    // Logos dos times (URLs da API/CDN)
    logoA: { type: String, default: '' },
    logoB: { type: String, default: '' },

    group: { type: String, required: true, trim: true }, // Ex: "Grupo A" ou "Rodada 1"
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
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);

// ---------- Virtuals ----------

// Retorna se a partida encerrou
MatchSchema.virtual('isFinished').get(function () {
  return this.status === 'finished';
});

// Verifica se o jogo está rolando
MatchSchema.virtual('isLive').get(function () {
  const liveStatus = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', 'penaltis'];
  return liveStatus.includes(this.status);
});

// Determina o vencedor para o cálculo do ranking
MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  
  const a = typeof this.scoreA === 'number' ? this.scoreA : null;
  const b = typeof this.scoreB === 'number' ? this.scoreB : null;
  
  if (a === null || b === null) return null;
  
  // 1. Se houve disputa de pênaltis, o vencedor real é decidido por eles
  if (this.penaltiesA !== null && this.penaltiesB !== null) {
      if (this.penaltiesA === this.penaltiesB) return 'D';
      return this.penaltiesA > this.penaltiesB ? 'A' : 'B';
  }

  // 2. Resultado do tempo normal/prorrogação
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; // Draw (Empate)
});

// ---------- Métodos Estáticos ----------

/**
 * Busca partidas filtradas por liga (Uso: Match.getByLeague(71))
 */
MatchSchema.statics.getByLeague = function (leagueId) {
  return this.find({ leagueId: Number(leagueId) }).sort({ date: 1, time: 1 });
};

/**
 * Finaliza a partida e salva os resultados
 */
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

/**
 * Reverte uma partida para o estado agendado
 */
MatchSchema.statics.unfinishMatch = async function (matchId, statusBack = 'scheduled') {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  match.status = statusBack; 
  match.scoreA = null;
  match.scoreB = null;
  match.penaltiesA = null;
  match.penaltiesB = null;
  match.minute = "";
  match.processed = false;

  await match.save();
  return match;
};

// Índices para performance
// Adicionado leagueId ao índice composto para buscas rápidas por liga
MatchSchema.index({ leagueId: 1, group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);
