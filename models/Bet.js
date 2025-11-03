const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Usuário é obrigatório'],
    unique: true, // 🔥 CADA USUÁRIO SÓ PODE TER UM REGISTRO DE PALPITES
    index: true
  },
  groupMatches: [{
    matchId: {
      type: Number,
      required: [true, 'ID do jogo é obrigatório'],
      min: [1, 'ID do jogo deve ser maior que 0']
    },
    bet: {
      type: String,
      required: [true, 'Palpite é obrigatório'],
      trim: true,
      match: [/^\d+\s*-\s*\d+$/, 'Formato de palpite inválido. Use: 2-1, 0-0, etc.']
    },
    scoreA: {
      type: Number,
      min: [0, 'Placar não pode ser negativo'],
      max: [15, 'Placar muito alto'],
      default: null
    },
    scoreB: {
      type: Number,
      min: [0, 'Placar não pode ser negativo'],
      max: [15, 'Placar muito alto'],
      default: null
    },
    points: {
      type: Number,
      min: [0, 'Pontos não podem ser negativos'],
      max: [10, 'Pontuação máxima excedida'],
      default: 0
    },
    calculated: {
      type: Boolean,
      default: false
    }
  }],
  podium: {
    first: {
      type: String,
      required: [function() { return this.hasSubmitted; }, '1º lugar é obrigatório'],
      trim: true,
      minlength: [2, 'Nome do time deve ter pelo menos 2 caracteres'],
      maxlength: [50, 'Nome do time muito longo']
    },
    second: {
      type: String,
      required: [function() { return this.hasSubmitted; }, '2º lugar é obrigatório'],
      trim: true,
      minlength: [2, 'Nome do time deve ter pelo menos 2 caracteres'],
      maxlength: [50, 'Nome do time muito longo']
    },
    third: {
      type: String,
      required: [function() { return this.hasSubmitted; }, '3º lugar é obrigatório'],
      trim: true,
      minlength: [2, 'Nome do time deve ter pelo menos 2 caracteres'],
      maxlength: [50, 'Nome do time muito longo']
    },
    points: {
      type: Number,
      min: [0, 'Pontos não podem ser negativos'],
      default: 0
    }
  },
  totalPoints: {
    type: Number,
    min: [0, 'Pontuação total não pode ser negativa'],
    default: 0
  },
  groupPoints: {
    type: Number,
    min: [0, 'Pontos dos jogos não podem ser negativos'],
    default: 0
  },
  podiumPoints: {
    type: Number,
    min: [0, 'Pontos do pódio não podem ser negativos'],
    default: 0
  },
  bonusPoints: {
    type: Number,
    min: [0, 'Pontos bônus não podem ser negativos'],
    default: 0
  },
  firstSubmission: {
    type: Date,
    default: null
  },
  lastUpdate: {
    type: Date,
    default: null
  },
  hasSubmitted: {
    type: Boolean,
    default: false
  },
  isCalculated: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ======================
// MIDDLEWARES (HOOKS)
// ======================

// 🔥 MIDDLEWARE PRE-SAVE: Processar scores dos palpites
betSchema.pre('save', function(next) {
  // Processar cada palpite para extrair scores
  this.groupMatches.forEach(matchBet => {
    if (matchBet.bet && !matchBet.calculated) {
      try {
        const scores = matchBet.bet.split('-').map(score => parseInt(score.trim()));
        if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
          matchBet.scoreA = scores[0];
          matchBet.scoreB = scores[1];
          matchBet.calculated = true;
        }
      } catch (error) {
        console.warn(`⚠️ Erro ao processar palpite: ${matchBet.bet}`);
      }
    }
  });

  // Atualizar lastUpdate quando houver mudanças
  if (this.isModified() && !this.isModified('lastUpdate')) {
    this.lastUpdate = new Date();
  }

  // Definir firstSubmission na primeira submissão
  if (this.hasSubmitted && !this.firstSubmission) {
    this.firstSubmission = new Date();
  }

  next();
});

// 🔥 MIDDLEWARE PRE-SAVE: Validar pódio único
betSchema.pre('save', function(next) {
  if (this.hasSubmitted && this.podium.first && this.podium.second && this.podium.third) {
    const podiumTeams = [this.podium.first, this.podium.second, this.podium.third];
    const uniqueTeams = [...new Set(podiumTeams)];
    
    if (uniqueTeams.length !== 3) {
      const error = new Error('Times do pódio devem ser diferentes');
      return next(error);
    }
  }
  next();
});

// ======================
// VIRTUAIS (CAMPOS CALCULADOS)
// ======================

// 🔥 VIRTUAL: Quantidade de palpites feitos
betSchema.virtual('betsCount').get(function() {
  return this.groupMatches.length;
});

// 🔥 VIRTUAL: Verificar se pódio está completo
betSchema.virtual('isPodiumComplete').get(function() {
  return !!(this.podium.first && this.podium.second && this.podium.third);
});

// 🔥 VIRTUAL: Tempo desde a submissão
betSchema.virtual('timeSinceSubmission').get(function() {
  if (!this.firstSubmission) return null;
  const now = new Date();
  const diffMs = now - this.firstSubmission;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (diffDays > 0) {
    return `${diffDays} dia${diffDays > 1 ? 's' : ''}`;
  } else {
    return `${diffHours} hora${diffHours > 1 ? 's' : ''}`;
  }
});

// ======================
// MÉTODOS DE INSTÂNCIA
// ======================

// 🔥 MÉTODO: Adicionar palpite para um jogo
betSchema.methods.addMatchBet = function(matchId, betString) {
  const existingBetIndex = this.groupMatches.findIndex(bet => bet.matchId === matchId);
  
  if (existingBetIndex >= 0) {
    // Atualizar palpite existente
    this.groupMatches[existingBetIndex].bet = betString;
    this.groupMatches[existingBetIndex].calculated = false; // Recalcular scores
  } else {
    // Adicionar novo palpite
    this.groupMatches.push({
      matchId: matchId,
      bet: betString,
      calculated: false
    });
  }
  
  return this.save();
};

// 🔥 MÉTODO: Definir pódio
betSchema.methods.setPodium = function(first, second, third) {
  this.podium.first = first;
  this.podium.second = second;
  this.podium.third = third;
  return this.save();
};

// 🔥 MÉTODO: Submeter palpites final
betSchema.methods.submitBets = function() {
  if (this.groupMatches.length === 0) {
    throw new Error('Adicione palpites antes de submeter');
  }
  
  if (!this.isPodiumComplete) {
    throw new Error('Preencha todas as posições do pódio');
  }
  
  this.hasSubmitted = true;
  this.firstSubmission = this.firstSubmission || new Date();
  return this.save();
};

// 🔥 MÉTODO: Calcular pontos (para implementação futura)
betSchema.methods.calculatePoints = async function() {
  // TODO: Implementar lógica de cálculo baseada nos resultados reais
  // Por enquanto, retorna pontos zerados
  this.totalPoints = 0;
  this.groupPoints = 0;
  this.podiumPoints = 0;
  this.bonusPoints = 0;
  this.isCalculated = false;
  
  return this.save();
};

// ======================
// MÉTODOS ESTÁTICOS
// ======================

// 🔥 MÉTODO ESTÁTICO: Buscar palpites por usuário
betSchema.statics.findByUser = function(userId) {
  return this.findOne({ user: userId })
    .populate('user', 'name email');
};

// 🔥 MÉTODO ESTÁTICO: Buscar todos os palpites submetidos
betSchema.statics.findSubmittedBets = function() {
  return this.find({ hasSubmitted: true })
    .populate('user', 'name email')
    .sort({ totalPoints: -1, firstSubmission: 1 });
};

// 🔥 MÉTODO ESTÁTICO: Buscar palpites para um jogo específico
betSchema.statics.findBetsForMatch = function(matchId) {
  return this.find({
    'groupMatches.matchId': matchId,
    hasSubmitted: true
  })
  .populate('user', 'name')
  .select('user groupMatches.$');
};

// 🔥 MÉTODO ESTÁTICO: Estatísticas de participação
betSchema.statics.getParticipationStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$hasSubmitted',
        count: { $sum: 1 }
      }
    }
  ]);
};

// ======================
// ÍNDICES PARA PERFORMANCE
// ======================
betSchema.index({ user: 1 });
betSchema.index({ hasSubmitted: 1 });
betSchema.index({ totalPoints: -1 });
betSchema.index({ 'groupMatches.matchId': 1 });
betSchema.index({ firstSubmission: -1 });

module.exports = mongoose.model('Bet', betSchema);
