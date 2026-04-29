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

    // --- 🚀 NOVOS CAMPOS ALINHADOS AO UPDATER (SPATIAL=TRUE) ---
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
  },
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);

// ---------- Middlewares ----------

MatchSchema.pre('save', function (next) {
  // Monitoramento de campos complexos para o ChangeStream
  const fields = ['goalsDetail', 'statistics', 'lineups', 'possession', 'xg', 'odds', 'unavailable'];
  fields.forEach(f => {
    if (this.isModified(f)) this.markModified(f);
  });

  const isKnockout = this.phase === 'knockout' || this.phase === 'mata-mata';
  
  if (this.status === 'finished' && isKnockout) {
    if (this.penaltiesA !== null && this.penaltiesB !== null) {
      if (this.penaltiesA > this.penaltiesB) this.qualifiedSide = 'A';
      else if (this.penaltiesB > this.penaltiesA) this.qualifiedSide = 'B';
    } 
    else if (this.scoreA !== null && this.scoreB !== null) {
      if (this.scoreA > this.scoreB) this.qualifiedSide = 'A';
      else if (this.scoreB > this.scoreA) this.qualifiedSide = 'B';
    }
  }
  next();
});

// ---------- Virtuals ----------

MatchSchema.virtual('isFinished').get(function () { return this.status === 'finished'; });

MatchSchema.virtual('isLive').get(function () {
  const liveStatus = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', '1_tet', '2_tet', 'penaltis'];
  return liveStatus.includes(this.status);
});

MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  const a = this.scoreA;
  const b = this.scoreB;
  if (a === null || b === null) return null;
  
  if (this.penaltiesA !== null && this.penaltiesB !== null) {
      if (this.penaltiesA === this.penaltiesB) return 'D';
      return this.penaltiesA > this.penaltiesB ? 'A' : 'B';
  }
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; 
});

// ---------- Métodos Estáticos (Originais Mantidos) ----------

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
