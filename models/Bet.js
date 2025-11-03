const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Usuário é obrigatório'],
    unique: true,
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
      max: [1, 'Pontuação máxima por jogo é 1 ponto'],
      default: 0
    },
    calculated: {
      type: Boolean,
      default: false
    },
    result: {
      type: String,  // ✅ STRING SIMPLES - 'teamA', 'teamB', 'draw'
      default: null
    }
  }],
  podium: {
    first: {
      type: String,  // ✅ STRING SIMPLES
      required: [function() { return this.hasSubmitted; }, '1º lugar é obrigatório'],
      trim: true,
      minlength: [2, 'Nome do time deve ter pelo menos 2 caracteres'],
      maxlength: [50, 'Nome do time muito longo']
    },
    second: {
      type: String,  // ✅ STRING SIMPLES
      required: [function() { return this.hasSubmitted; }, '2º lugar é obrigatório'],
      trim: true,
      minlength: [2, 'Nome do time deve ter pelo menos 2 caracteres'],
      maxlength: [50, 'Nome do time muito longo']
    },
    third: {
      type: String,  // ✅ STRING SIMPLES
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
  },
  rankingPosition: {
    type: Number,
    default: 0
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
  // Processar cada palpite para extrair scores e resultado
  this.groupMatches.forEach(matchBet => {
    if (matchBet.bet && !matchBet.calculated) {
      try {
        const scores = matchBet.bet.split('-').map(score => parseInt(score.trim()));
        if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
          matchBet.scoreA = scores[0];
          matchBet.scoreB = scores[1];
          
          // 🔥 CALCULAR RESULTADO DO PALPITE (não pontos ainda)
          if (scores[0] > scores[1]) {
            matchBet.result = 'teamA';
          } else if (scores[1] > scores[0]) {
            matchBet.result = 'teamB';
          } else {
            matchBet.result = 'draw';
          }
          
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

// 🔥 VIRTUAL: Pontos totais dos jogos (calculado)
betSchema.virtual('calculatedGroupPoints').get(function() {
  return this.groupMatches.reduce((sum, match) => sum + (match.points || 0), 0);
});

// 🔥 VIRTUAL: Acertos nos jogos
betSchema.virtual('correctBets').get(function() {
  return this.groupMatches.filter(match => match.points > 0).length;
});

// 🔥 VIRTUAL: Porcentagem de acertos
betSchema.virtual('accuracyRate').get(function() {
  if (this.groupMatches.length === 0) return 0;
  return ((this.correctBets / this.groupMatches.length) * 100).toFixed(1);
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
    this.groupMatches[existingBetIndex].calculated = false; // Recalcular
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

// 🔥 MÉTODO: Calcular pontos baseado apenas no RESULTADO
betSchema.methods.calculatePoints = async function(actualMatches, actualPodium = null) {
  console.log('🏆 CALCULANDO PONTOS - Sistema de Resultado');
  
  let groupPoints = 0;
  let podiumPoints = 0;
  
  // 🔥 CALCULAR PONTOS DOS JOGOS (1 ponto por acerto de resultado)
  this.groupMatches.forEach(matchBet => {
    const actualMatch = actualMatches.find(m => m.matchId === matchBet.matchId);
    
    if (actualMatch && actualMatch.status === 'finished' && actualMatch.winner) {
      console.log(`🔍 Jogo ${matchBet.matchId}:`);
      console.log(`- Palpite: ${matchBet.bet} (resultado: ${matchBet.result})`);
      console.log(`- Real: ${actualMatch.scoreA}-${actualMatch.scoreB} (resultado: ${actualMatch.winner})`);
      
      // 🔥 COMPARAR APENAS O RESULTADO (vencedor/empate)
      if (matchBet.result === actualMatch.winner) {
        matchBet.points = 1; // 1 ponto por acertar o resultado
        groupPoints += 1;
        console.log(`✅ ACERTOU! +1 ponto`);
      } else {
        matchBet.points = 0;
        console.log(`❌ ERROU! 0 pontos`);
      }
    } else {
      matchBet.points = 0;
    }
  });
  
  // 🔥 CALCULAR PONTOS DO PÓDIO (se fornecido)
  if (actualPodium) {
    console.log('🏅 CALCULANDO PÓDIO:');
    console.log('- Palpite:', this.podium);
    console.log('- Real:', actualPodium);
    
    if (this.podium.first === actualPodium.first) {
      podiumPoints += 10;
      console.log('✅ Acertou campeão! +10 pontos');
    }
    if (this.podium.second === actualPodium.second) {
      podiumPoints += 7;
      console.log('✅ Acertou vice! +7 pontos');
    }
    if (this.podium.third === actualPodium.third) {
      podiumPoints += 4;
      console.log('✅ Acertou terceiro! +4 pontos');
    }
    
    this.podium.points = podiumPoints;
  }
  
  // Calcular totais
  this.groupPoints = groupPoints;
  this.podiumPoints = podiumPoints;
  this.totalPoints = groupPoints + podiumPoints + this.bonusPoints;
  this.isCalculated = true;
  
  console.log(`📊 PONTUAÇÃO FINAL:`);
  console.log(`- Jogos: ${groupPoints} pontos`);
  console.log(`- Pódio: ${podiumPoints} pontos`);
  console.log(`- Bônus: ${this.bonusPoints} pontos`);
  console.log(`- TOTAL: ${this.totalPoints} pontos`);
  
  await this.save();
  return this;
};

// 🔥 MÉTODO: Simular pontuação (para preview)
betSchema.methods.simulatePoints = function(actualMatches, actualPodium = null) {
  let simulatedGroupPoints = 0;
  let simulatedPodiumPoints = 0;
  
  // Simular pontos dos jogos
  this.groupMatches.forEach(matchBet => {
    const actualMatch = actualMatches.find(m => m.matchId === matchBet.matchId);
    
    if (actualMatch && actualMatch.status === 'finished' && actualMatch.winner) {
      if (matchBet.result === actualMatch.winner) {
        simulatedGroupPoints += 1;
      }
    }
  });
  
  // Simular pontos do pódio
  if (actualPodium) {
    if (this.podium.first === actualPodium.first) simulatedPodiumPoints += 10;
    if (this.podium.second === actualPodium.second) simulatedPodiumPoints += 7;
    if (this.podium.third === actualPodium.third) simulatedPodiumPoints += 4;
  }
  
  return {
    groupPoints: simulatedGroupPoints,
    podiumPoints: simulatedPodiumPoints,
    totalPoints: simulatedGroupPoints + simulatedPodiumPoints + this.bonusPoints,
    correctBets: this.groupMatches.filter(matchBet => {
      const actualMatch = actualMatches.find(m => m.matchId === matchBet.matchId);
      return actualMatch && actualMatch.status === 'finished' && 
             matchBet.result === actualMatch.winner;
    }).length
  };
};

// 🔥 MÉTODO: Adicionar pontos bônus
betSchema.methods.addBonusPoints = function(points, reason = '') {
  this.bonusPoints += points;
  console.log(`🎁 Bônus adicionado: +${points} pontos (${reason})`);
  return this.save();
};

// 🔥 MÉTODO: Resetar cálculo
betSchema.methods.resetCalculation = function() {
  this.groupMatches.forEach(match => {
    match.points = 0;
  });
  this.podium.points = 0;
  this.groupPoints = 0;
  this.podiumPoints = 0;
  this.totalPoints = 0;
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

// 🔥 MÉTODO ESTÁTICO: Recalcular todos os pontos
betSchema.statics.recalculateAllPoints = async function(actualMatches, actualPodium = null) {
  console.log('🔄 RECALCULANDO TODOS OS PONTOS...');
  
  const bets = await this.find({ hasSubmitted: true });
  let updatedCount = 0;
  
  for (const bet of bets) {
    await bet.calculatePoints(actualMatches, actualPodium);
    updatedCount++;
  }
  
  console.log(`✅ ${updatedCount} palpites recalculados`);
  return updatedCount;
};

// 🔥 MÉTODO ESTÁTICO: Atualizar ranking
betSchema.statics.updateRanking = async function() {
  const bets = await this.find({ hasSubmitted: true })
    .sort({ totalPoints: -1, firstSubmission: 1 })
    .populate('user', 'name');
  
  let position = 1;
  for (const bet of bets) {
    bet.rankingPosition = position;
    await bet.save();
    position++;
  }
  
  console.log(`🏆 Ranking atualizado: ${bets.length} participantes`);
  return bets.length;
};

// 🔥 MÉTODO ESTÁTICO: Estatísticas gerais
betSchema.statics.getGlobalStats = async function() {
  const totalBets = await this.countDocuments({ hasSubmitted: true });
  const totalPoints = await this.aggregate([
    { $match: { hasSubmitted: true } },
    { $group: { _id: null, total: { $sum: '$totalPoints' } } }
  ]);
  
  const avgPoints = totalPoints.length > 0 ? totalPoints[0].total / totalBets : 0;
  
  return {
    totalParticipants: totalBets,
    totalPoints: totalPoints.length > 0 ? totalPoints[0].total : 0,
    averagePoints: Math.round(avgPoints * 100) / 100,
    calculatedBets: await this.countDocuments({ isCalculated: true })
  };
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
betSchema.index({ rankingPosition: 1 });

module.exports = mongoose.model('Bet', betSchema);
