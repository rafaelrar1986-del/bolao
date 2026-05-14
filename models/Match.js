const mongoose = require('mongoose');
const { Schema } = mongoose;

const MatchSchema = new Schema(
  {
    matchId: { type: Number, required: true, index: true },
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
    date: { type: String, required: true, trim: true }, 
    time: { type: String, required: true, trim: true },

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

    // --- 🚀 NOVO: DETALHAMENTO DE PÊNALTIS PARA O FRONT ---
    shootoutDetail: { type: Array, default: [] }, 

    xg: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 }
    },
    odds: {
      home: { type: Number, default: null },
      draw: { type: Number, default: null },
      away: { type: Number, default: null }
    },
    unavailable: { type: Array, default: [] },
    ai_analysis: { type: String, default: '' },
    video_url: { type: String, default: '' },

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

    statistics: { type: Array, default: [] },

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
    apiId: { type: Number, required: true, unique: true, index: true },
  },
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);

// ---------- Middlewares ----------

MatchSchema.pre('save', function (next) {
  // Monitoramento expandido
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

    // PRIORIDADE DE CLASSIFICAÇÃO: Pênaltis primeiro
    if (pA !== null && pB !== null && pA !== pB) {
      this.qualifiedSide = pA > pB ? 'A' : 'B';
    } 
    else if (sA !== null && sB !== null && sA !== sB) {
      this.qualifiedSide = sA > sB ? 'A' : 'B';
    } 
    else {
      this.qualifiedSide = null;
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

MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  
  const a = this.scoreA;
  const b = this.scoreB;
  if (a === null || b === null) return null;
  
  // REGRA SOLICITADA: Jogo independente dos pênaltis
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; 
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
  match.shootoutDetail = []; // Limpa também o detalhe
  match.lineups = { home: {}, away: {} };
  await match.save();
  return match;
};

MatchSchema.index({ leagueId: 1, group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);
