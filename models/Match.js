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
    type: String,
    required: [true, 'Time A é obrigatório'],
    trim: true,
    maxlength: [50, 'Nome do time não pode exceder 50 caracteres']
  },
  teamB: {
    type: String,
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
    type: String,
    required: [true, 'Grupo é obrigatório'],
    trim: true,
    enum: {
      values: ['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D', 'Grupo E', 'Grupo F', 'Grupo G', 'Grupo H', 'Oitavas', 'Quartas', 'Semifinal', 'Final', 'Disputa 3º'],
      message: 'Grupo {VALUE} não é válido'
    }
  },
  stadium: {
    type: String,
    trim: true,
    maxlength: [100, 'Nome do estádio não pode exceder 100 caracteres'],
    default: 'A definir'
  },
  status: {
    type: String,
    enum: {
      values: ['scheduled', 'in_progress', 'finished', 'cancelled', 'postponed'],
      message: 'Status {VALUE} não é válido'
    },
    default: 'scheduled'
  },
  winner: {
    type: String,
    enum: {
      values: ['teamA', 'teamB', 'draw'],
      message: 'Vencedor {VALUE} não é válido'
    },
    default: null
  },
  scoreA: {
    type: Number,
    min: [0, 'Placar não pode ser negativo'],
    max: [20, 'Placar muito alto'],
    default: null,
    validate: {
      validator: function(value) {
        // Só valida se o jogo estiver finalizado
        if (this.status === 'finished') {
          return value !== null && value >= 0;
        }
        return true;
      },
      message: 'Placar do time A é obrigatório para jogos finalizados'
    }
  },
  scoreB: {
    type: Number,
    min: [0, 'Placar não pode ser negativo'],
    max: [20, 'Placar muito alto'],
    default: null,
    validate: {
      validator: function(value) {
        // Só valida se o jogo estiver finalizado
        if (this.status === 'finished') {
          return value !== null && value >= 0;
        }
        return true;
      },
      message: 'Placar do time B é obrigatório para jogos finalizados'
    }
  },
  isFinished: {
    type: Boolean,
    default: false
  },
  datetime: {
    type: Date,
    // Campo calculado para ordenação - será preenchido automaticamente
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ======================
// MIDDLEWARES (HOOKS)
// ======================

// 🔥 MIDDLEWARE PRE-SAVE: Calcular datetime para ordenação
matchSchema.pre('save', function(next) {
  if (this.date && this.time) {
    try {
      const [day, month, year] = this.date.split('/');
      const [hours, minutes] = this.time.split(':');
      
      // Criar Date object (meses são 0-indexed no JavaScript)
      this.datetime = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes)
      );
    } catch (error) {
      console.warn(`⚠️ Erro ao converter data/hora para o jogo ${this.matchId}:`, error.message);
    }
  }
  next();
});

// 🔥 MIDDLEWARE PRE-SAVE: Sincronizar status com isFinished
matchSchema.pre('save', function(next) {
  // Sincronizar isFinished com status
  this.isFinished = this.status === 'finished';
  
  // Se o jogo está finalizado, garantir que há placar
  if (this.status === 'finished' && (this.scoreA === null || this.scoreB === null)) {
    const error = new Error('Jogos finalizados devem ter placar definido');
    return next(error);
  }
  
  // Determinar vencedor automaticamente se o jogo está finalizado
  if (this.status === 'finished' && this.scoreA !== null && this.scoreB !== null) {
    if (this.scoreA > this.scoreB) {
      this.winner = 'teamA';
    } else if (this.scoreB > this.scoreA) {
      this.winner = 'teamB';
    } else {
      this.winner = 'draw';
    }
  }
  
  next();
});

// ======================
// VIRTUAIS (CAMPOS CALCULADOS)
// ======================

// 🔥 VIRTUAL: Nome do jogo formatado
matchSchema.virtual('matchName').get(function() {
  return `${this.teamA} vs ${this.teamB}`;
});

// 🔥 VIRTUAL: Placar formatado
matchSchema.virtual('formattedScore').get(function() {
  if (this.scoreA !== null && this.scoreB !== null) {
    return `${this.scoreA} - ${this.scoreB}`;
  }
  return 'A definir';
});

// 🔥 VIRTUAL: Data e hora formatadas
matchSchema.virtual('fullDateTime').get(function() {
  return `${this.date} às ${this.time}`;
});

// 🔥 VIRTUAL: Verificar se o jogo já aconteceu
matchSchema.virtual('hasStarted').get(function() {
  if (!this.datetime) return false;
  return new Date() > this.datetime;
});

// 🔥 VIRTUAL: Verificar se pode receber palpites
matchSchema.virtual('canBet').get(function() {
  if (!this.datetime) return true;
  const now = new Date();
  const matchTime = new Date(this.datetime);
  const oneHourBefore = new Date(matchTime.getTime() - (60 * 60 * 1000));
  
  return now < oneHourBefore && this.status === 'scheduled';
});

// ======================
// MÉTODOS DE INSTÂNCIA
// ======================

// 🔥 MÉTODO: Finalizar jogo com placar
matchSchema.methods.finishMatch = function(scoreA, scoreB) {
  this.scoreA = scoreA;
  this.scoreB = scoreB;
  this.status = 'finished';
  this.isFinished = true;
  
  // Vencedor é calculado automaticamente no pre-save
  return this.save();
};

// 🔥 MÉTODO: Iniciar jogo
matchSchema.methods.startMatch = function() {
  this.status = 'in_progress';
  return this.save();
};

// 🔥 MÉTODO: Cancelar jogo
matchSchema.methods.cancelMatch = function() {
  this.status = 'cancelled';
  this.scoreA = null;
  this.scoreB = null;
  this.winner = null;
  return this.save();
};

// ======================
// MÉTODOS ESTÁTICOS
// ======================

// 🔥 MÉTODO ESTÁTICO: Buscar jogos por status
matchSchema.statics.findByStatus = function(status) {
  return this.find({ status }).sort({ datetime: 1 });
};

// 🔥 MÉTODO ESTÁTICO: Buscar próximos jogos
matchSchema.statics.findUpcoming = function(limit = 5) {
  return this.find({ 
    status: 'scheduled',
    datetime: { $gt: new Date() }
  })
  .sort({ datetime: 1 })
  .limit(limit);
};

// 🔥 MÉTODO ESTÁTICO: Buscar jogos finalizados
matchSchema.statics.findFinished = function() {
  return this.find({ status: 'finished' }).sort({ datetime: -1 });
};

// 🔥 MÉTODO ESTÁTICO: Buscar por grupo
matchSchema.statics.findByGroup = function(groupName) {
  return this.find({ 
    group: new RegExp(groupName, 'i') 
  }).sort({ datetime: 1 });
};

// ======================
// ÍNDICES PARA PERFORMANCE
// ======================
matchSchema.index({ matchId: 1 });
matchSchema.index({ group: 1 });
matchSchema.index({ status: 1 });
matchSchema.index({ datetime: 1 });
matchSchema.index({ date: 1, time: 1 });
matchSchema.index({ teamA: 1, teamB: 1 });

module.exports = mongoose.model('Match', matchSchema);
