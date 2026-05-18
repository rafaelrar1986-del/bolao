const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Status Detalhado: Sincronizado com statusMap do Updater
 */
const MatchSchema = new Schema(
  {
    // ID Único da partida
    matchId: { type: Number, required: true, index: true },

    // IDENTIFICAÇÃO DA LIGA
    leagueId: { type: Number, required: false, index: true }, 
    leagueName: { type: String, default: '' },

    phaseName: { type: String, required: false, trim: true },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    logoA: { type: String, default: '' },
    logoB: { type: String, default: '' },

    group: { type: String, required: true, trim: true }, 
    phase: { type: String, enum: ['group', 'knockout', 'mata-mata'], default: 'group', index: true },

    // 🏆 QUEM PASSOU DE FASE (Definido prioritariamente pelos Pênaltis)
    qualifiedSide: { type: String, enum: ['A', 'B', null], default: null },
    
    stadium: { type: String, default: '', trim: true },

    date: { type: String, required: true, trim: true }, // "DD/MM/AAAA"
    time: { type: String, required: true, trim: true }, // "HH:MM"

    status: {
      type: String,
      enum: [
        'scheduled', '1_tempo', 'intervalo', '2_tempo', 'prorrogacao', 
        '1_tet', '2_tet', 'penaltis', 'finished', 'cancelled', 'postponed'
      ],
      default: 'scheduled',
      index: true,
    },
    
    scoreA: { type: Number, default: null, min: 0 },
    scoreB: { type: Number, default: null, min: 0 },

    penaltiesA: { type: Number, default: null },
    penaltiesB: { type: Number, default: null },

    // --- 🚀 DETALHAMENTO DE PÊNALTIS PARA O FRONT-END ---
    shootoutDetail: { type: Array, default: [] }, 

    // --- CAMPOS ALINHADOS AO UPDATER (SPATIAL=TRUE) ---
    xg: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 }
    },
    odds: {
      home: { type: Number, default: null },
      draw: { type: Number, default: null },
      away: { type: Number, default: null }
    },
    unavailable: { type: Array, default: [] }, // Desfalques
    ai_analysis: { type: String, default: '' }, // Preview de IA
    video_url: { type: String, default: '' },   // Highlights
    // -----------------------------------------------------------

    // EVENTOS COMPLETOS (Gols, VAR, Substituições)
    goalsDetail: [
      {
        type: { type: String },          
        name: { type: String },          
        min: { type: Number },           
        extra: { type: Number },        
        side: { type: String, enum: ['home', 'away'] },
        description: { type: String },  
        playerIn: { type: String },     
        playerOut: { type: String }     
      }
    ],

    possession: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 }
    },

    statistics: { type: Array, default: [] }, // live_stats

    lineups: {
      home: {
        formation: { type: String, default: "" },
        players: { type: Array, default: [] },
        substitutes: { type: Array, default: [] }
      },
      away: {
        formation: { type: String, default: "" },
        players: { type: Array, default: [] },
        substitutes: { type: Array, default: [] }
      },
      confirmed: { type: Boolean, default: false }
    },
    apiStatus: { type: String, default: 'NS' }, 
    minute: { type: String, default: '' },      
    
    processed: { type: Boolean, default: false }, 

    betsCount: { type: Number, default: 0 },
    apiId: {
      type: Number,
      required: true, 
      unique: true,   
      index: true      
    },

    // 🚨 NOVOS CAMPOS DE CONTROLE PARA SUPORTE À V2 E IGNORAR SE SLEEP NO RENDER
    scoutsConsolidated: { type: Boolean, default: false, index: true }, 
    apiLastUpdated: { type: String, default: null } 
  },
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);

// ---------- Middlewares ----------

MatchSchema.pre('save', function (next) {
  // Monitoramento de campos complexos para o ChangeStream (SSE)
  const fields = ['goalsDetail', 'statistics', 'lineups', 'possession', 'xg', 'odds', 'unavailable', 'shootoutDetail'];
  fields.forEach(f => {
    if (this.isModified(f)) this.markModified(f);
  });

  const isKnockout = this.phase === 'knockout' || this.phase === 'mata-mata';
  
  if (isKnockout) {
    const sA = this.scoreA;
    const sB = this.scoreB;
    const pA = this.penaltiesA;
    const pB = this.penaltiesB;

    // 1. Prioridade Máxima: Pênaltis (Cálculo automático se houver disputa)
    if (pA !== null && pB !== null && pA !== pB) {
      this.qualifiedSide = pA > pB ? 'A' : 'B';
    } 
    // 2. Segunda Prioridade: Gols (Se não houve pênaltis ou não terminou em empate)
    else if (sA !== null && sB !== null && sA !== sB) {
      this.qualifiedSide = sA > sB ? 'A' : 'B';
    } 
    // 3. Caso de Empate Real (Ex: 1x1 sem penais)
    else {
      // 💡 TRAVA MANUAL: Se você definiu o qualificado no painel, o robô não limpa o campo.
      // Ele só limpa se o campo estiver vazio, evitando apagar sua decisão manual.
      if (!this.qualifiedSide) {
        this.qualifiedSide = null;
      }
    }
  }

  next();
});

// ---------- Virtuals ----------

MatchSchema.virtual('isFinished').get(function () { 
  return this.status === 'finished'; 
});

MatchSchema.virtual('isLive').get(function () {
  const liveStatus = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', '1_tet', '2_tet', 'penaltis'];
  return liveStatus.includes(this.status);
});

/**
 * 🎯 VENCEDOR PARA O BOLÃO (Winner): Totalmente independente dos Pênaltis.
 * Só considera scoreA e scoreB (Tempo normal + prorrogação).
 */
MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  
  const a = this.scoreA;
  const b = this.scoreB;
  if (a === null || b === null) return null;
  
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
  match.scoutsConsolidated = true; // Força como consolidado se finalizado manualmente via static
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
  match.scoutsConsolidated = false; // Libera novamente para processamento do robô
  match.apiLastUpdated = null;
  match.goalsDetail = [];
  match.statistics = [];
  match.shootoutDetail = []; 
  match.lineups = { home: {}, away: {} };
  await match.save();
  return match;
};

MatchSchema.index({ leagueId: 1, group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);
