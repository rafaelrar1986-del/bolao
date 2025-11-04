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
    },
    processedAt: {
      type: Date,
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
    },
    calculated: {
      type: Boolean,
      default: false
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
  },
  lastPointsCalculation: {
    type: Date,
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

// 🔥 VIRTUAL: Nome do usuário (para facilitar)
betSchema.virtual('userName').get(function() {
  return this.user ? this.user.name : 'Usuário';
});

// ======================
// MÉTODOS DE INSTÂNCIA (ATUALIZADOS)
// ======================

// 🔥 MÉTODO: Adicionar palpite para um jogo
betSchema.methods.addMatchBet = function(matchId, betString) {
  const existingBetIndex = this.groupMatches.findIndex(bet => bet.matchId === matchId);
  
  if (existingBetIndex >= 0) {
    // Atualizar palpite existente
    this.groupMatches[existingBetIndex].bet = betString;
    this.groupMatches[existingBetIndex].calculated = false; // Recalcular
    this.groupMatches[existingBetIndex].points = 0; // Resetar pontos
    this.groupMatches[existingBetIndex].processedAt = null;
  } else {
    // Adicionar novo palpite
    this.groupMatches.push({
      matchId: matchId,
      bet: betString,
      calculated: false,
      points: 0
    });
  }
  
  return this.save();
};

// 🔥 MÉTODO: Definir pódio
betSchema.methods.setPodium = function(first, second, third) {
  this.podium.first = first;
  this.podium.second = second;
  this.podium.third = third;
  this.podium.calculated = false; // Marcar para recalcular pontos
  this.podium.points = 0; // Resetar pontos
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

// 🔥 MÉTODO PRINCIPAL: Calcular pontos baseado apenas no RESULTADO (ATUALIZADO)
betSchema.methods.calculatePoints = async function(actualMatches = [], actualPodium = null) {
  console.log(`🏆 CALCULANDO PONTOS para ${this.userName}`);
  
  let groupPoints = 0;
  let podiumPoints = 0;
  let updatedMatches = 0;
  
  // 🔥 CALCULAR PONTOS DOS JOGOS (1 ponto por acerto de resultado)
  this.groupMatches.forEach(matchBet => {
    const actualMatch = actualMatches.find(m => m.matchId === matchBet.matchId);
    
    if (actualMatch && actualMatch.status === 'finished' && actualMatch.winner) {
      const previousPoints = matchBet.points || 0;
      
      // 🔥 COMPARAR APENAS O RESULTADO (vencedor/empate)
      if (matchBet.result === actualMatch.winner) {
        matchBet.points = 1; // 1 ponto por acertar o resultado
        groupPoints += 1;
        
        if (previousPoints === 0) {
          console.log(`✅ ACERTOU Jogo ${matchBet.matchId}! +1 ponto`);
          updatedMatches++;
        }
      } else {
        matchBet.points = 0;
        if (previousPoints > 0) {
          console.log(`🔄 PERDEU PONTOS Jogo ${matchBet.matchId}! -1 ponto`);
          updatedMatches++;
        }
      }
      
      matchBet.processedAt = new Date();
    } else {
      // Resetar pontos se a partida não está finalizada
      if (matchBet.points > 0) {
        matchBet.points = 0;
        matchBet.processedAt = null;
        updatedMatches++;
      }
    }
  });
  
  // 🔥 CALCULAR PONTOS DO PÓDIO (se fornecido)
  if (actualPodium && this.podium.first && this.podium.second && this.podium.third) {
    console.log('🏅 CALCULANDO PÓDIO:');
    console.log('- Palpite:', this.podium);
    console.log('- Real:', actualPodium);
    
    const previousPodiumPoints = this.podium.points || 0;
    podiumPoints = 0;
    
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
    this.podium.calculated = true;
    
    if (podiumPoints !== previousPodiumPoints) {
      console.log(`🔄 Pódio atualizado: ${previousPodiumPoints} → ${podiumPoints} pontos`);
      updatedMatches++;
    }
  }
  
  // Calcular totais
  this.groupPoints = groupPoints;
  this.podiumPoints = podiumPoints;
  this.totalPoints = groupPoints + podiumPoints + this.bonusPoints;
  this.isCalculated = true;
  this.lastPointsCalculation = new Date();

  console.log(`📊 PONTUAÇÃO FINAL para ${this.userName}:`);
  console.log(`- Jogos: ${groupPoints} pontos`);
  console.log(`- Pódio: ${podiumPoints} pontos`);
  console.log(`- Bônus: ${this.bonusPoints} pontos`);
  console.log(`- TOTAL: ${this.totalPoints} pontos`);
  console.log(`- Atualizações: ${updatedMatches} itens modificados`);

  await this.save();
  return {
    groupPoints,
    podiumPoints,
    totalPoints: this.totalPoints,
    updatedMatches,
    user: this.userName
  };
};

// 🔥 MÉTODO: Calcular pontos para uma partida específica (NOVO)
betSchema.methods.calculatePointsForMatch = async function(matchId, actualMatch) {
  console.log(`🎯 Calculando pontos para jogo ${matchId} - ${this.userName}`);
  
  const matchBet = this.groupMatches.find(bet => bet.matchId === matchId);
  
  if (!matchBet) {
    console.log(`⚠️ Usuário ${this.userName} não tem palpite para jogo ${matchId}`);
    return { points: 0, updated: false };
  }
  
  if (!actualMatch || actualMatch.status !== 'finished' || !actualMatch.winner) {
    console.log(`⚠️ Jogo ${matchId} não está finalizado`);
    return { points: 0, updated: false };
  }
  
  const previousPoints = matchBet.points || 0;
  let newPoints = 0;
  
  // 🔥 COMPARAR RESULTADO (1 ponto por acerto)
  if (matchBet.result === actualMatch.winner) {
    newPoints = 1;
    console.log(`✅ ${this.userName} ACERTOU jogo ${matchId}! +1 ponto`);
  } else {
    newPoints = 0;
    console.log(`❌ ${this.userName} ERROU jogo ${matchId}! 0 pontos`);
  }
  
  // Atualizar apenas se mudou
  if (previousPoints !== newPoints) {
    matchBet.points = newPoints;
    matchBet.processedAt = new Date();
    
    // Recalcular totais
    await this.calculateGroupPointsTotal();
    
    console.log(`🔄 ${this.userName}: Jogo ${matchId} ${previousPoints} → ${newPoints} pontos`);
    
    await this.save();
    return { points: newPoints, updated: true };
  }
  
  return { points: newPoints, updated: false };
};

// 🔥 MÉTODO: Recalcular apenas pontos dos jogos (NOVO)
betSchema.methods.calculateGroupPointsTotal = async function() {
  const groupPoints = this.groupMatches.reduce((sum, match) => sum + (match.points || 0), 0);
  
  if (this.groupPoints !== groupPoints) {
    this.groupPoints = groupPoints;
    this.totalPoints = groupPoints + this.podiumPoints + this.bonusPoints;
    this.lastPointsCalculation = new Date();
    console.log(`🔄 ${this.userName}: Pontos jogos atualizado ${this.groupPoints} → ${groupPoints}`);
  }
  
  return groupPoints;
};

// 🔥 MÉTODO: Simular pontuação (para preview)
betSchema.methods.simulatePoints = function(actualMatches = [], actualPodium = null) {
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
  
  const totalPoints = simulatedGroupPoints + simulatedPodiumPoints + this.bonusPoints;
  
  return {
    groupPoints: simulatedGroupPoints,
    podiumPoints: simulatedPodiumPoints,
    totalPoints: totalPoints,
    bonusPoints: this.bonusPoints,
    correctBets: this.groupMatches.filter(matchBet => {
      const actualMatch = actualMatches.find(m => m.matchId === matchBet.matchId);
      return actualMatch && actualMatch.status === 'finished' && 
             matchBet.result === actualMatch.winner;
    }).length,
    totalMatches: actualMatches.filter(m => m.status === 'finished').length
  };
};

// 🔥 MÉTODO: Adicionar pontos bônus
betSchema.methods.addBonusPoints = function(points, reason = '') {
  const previousBonus = this.bonusPoints;
  this.bonusPoints += points;
  
  // Recalcular total
  this.totalPoints = this.groupPoints + this.podiumPoints + this.bonusPoints;
  
  console.log(`🎁 Bônus adicionado para ${this.userName}: +${points} pontos (${reason})`);
  console.log(`📊 Bônus: ${previousBonus} → ${this.bonusPoints} pontos`);
  
  return this.save();
};

// 🔥 MÉTODO: Resetar cálculo
betSchema.methods.resetCalculation = function() {
  console.log(`🔄 Resetando cálculo para ${this.userName}`);
  
  this.groupMatches.forEach(match => {
    match.points = 0;
    match.processedAt = null;
  });
  
  this.podium.points = 0;
  this.podium.calculated = false;
  this.groupPoints = 0;
  this.podiumPoints = 0;
  this.totalPoints = 0;
  this.bonusPoints = 0;
  this.isCalculated = false;
  this.lastPointsCalculation = null;
  
  return this.save();
};

// 🔥 MÉTODO: Obter estatísticas detalhadas (NOVO)
betSchema.methods.getDetailedStats = function(actualMatches = []) {
  const finishedMatches = actualMatches.filter(m => m.status === 'finished');
  const userBets = this.groupMatches;
  
  const stats = {
    totalBets: userBets.length,
    finishedMatches: finishedMatches.length,
    correctBets: userBets.filter(bet => {
      const match = finishedMatches.find(m => m.matchId === bet.matchId);
      return match && bet.result === match.winner;
    }).length,
    accuracy: 0,
    pointsBreakdown: {
      group: this.groupPoints,
      podium: this.podiumPoints,
      bonus: this.bonusPoints,
      total: this.totalPoints
    },
    recentUpdates: this.groupMatches
      .filter(bet => bet.processedAt)
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt))
      .slice(0, 5)
      .map(bet => ({
        matchId: bet.matchId,
        points: bet.points,
        processedAt: bet.processedAt
      }))
  };
  
  stats.accuracy = stats.totalBets > 0 ? (stats.correctBets / stats.totalBets) * 100 : 0;
  
  return stats;
};

// ======================
// MÉTODOS ESTÁTICOS (ATUALIZADOS)
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

// 🔥 MÉTODO ESTÁTICO: Recalcular todos os pontos (ATUALIZADO)
betSchema.statics.recalculateAllPoints = async function(actualMatches = [], actualPodium = null) {
  console.log('🔄 RECALCULANDO TODOS OS PONTOS...');
  
  const bets = await this.find({ hasSubmitted: true }).populate('user', 'name');
  let updatedCount = 0;
  let totalUpdatedMatches = 0;
  
  for (const bet of bets) {
    try {
      const result = await bet.calculatePoints(actualMatches, actualPodium);
      if (result.updatedMatches > 0) {
        updatedCount++;
        totalUpdatedMatches += result.updatedMatches;
      }
    } catch (error) {
      console.error(`❌ Erro ao recalcular pontos para ${bet.userName}:`, error);
    }
  }
  
  console.log(`✅ ${updatedCount}/${bets.length} palpites atualizados, ${totalUpdatedMatches} itens modificados`);
  return { updatedBets: updatedCount, totalBets: bets.length, updatedItems: totalUpdatedMatches };
};

// 🔥 MÉTODO ESTÁTICO: Recalcular pontos para uma partida específica (NOVO)
betSchema.statics.recalculatePointsForMatch = async function(matchId, actualMatch) {
  console.log(`🎯 RECALCULANDO PONTOS para partida ${matchId}...`);
  
  const bets = await this.find({ 
    'groupMatches.matchId': matchId,
    hasSubmitted: true 
  }).populate('user', 'name');
  
  let updatedCount = 0;
  
  for (const bet of bets) {
    try {
      const result = await bet.calculatePointsForMatch(matchId, actualMatch);
      if (result.updated) {
        updatedCount++;
      }
    } catch (error) {
      console.error(`❌ Erro ao recalcular pontos para ${bet.userName}:`, error);
    }
  }
  
  console.log(`✅ ${updatedCount}/${bets.length} palpites atualizados para partida ${matchId}`);
  return { updatedBets: updatedCount, totalBets: bets.length };
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
  
  // Estatísticas de pontos
  const pointsStats = await this.aggregate([
    { $match: { hasSubmitted: true } },
    { 
      $group: {
        _id: null,
        avgGroupPoints: { $avg: '$groupPoints' },
        avgPodiumPoints: { $avg: '$podiumPoints' },
        maxPoints: { $max: '$totalPoints' },
        minPoints: { $min: '$totalPoints' }
      }
    }
  ]);
  
  return {
    totalParticipants: totalBets,
    totalPoints: totalPoints.length > 0 ? totalPoints[0].total : 0,
    averagePoints: Math.round(avgPoints * 100) / 100,
    calculatedBets: await this.countDocuments({ isCalculated: true }),
    pointsStats: pointsStats.length > 0 ? pointsStats[0] : {}
  };
};

// 🔥 MÉTODO ESTÁTICO: Buscar palpites para um jogo específico
betSchema.statics.findBetsForMatch = function(matchId) {
  return this.find({
    'groupMatches.matchId': matchId,
    hasSubmitted: true
  })
  .populate('user', 'name')
  .select('user groupMatches.$ totalPoints groupPoints');
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

// 🔥 MÉTODO ESTÁTICO: Top participantes (NOVO)
betSchema.statics.getTopParticipants = async function(limit = 10) {
  return this.find({ hasSubmitted: true })
    .populate('user', 'name')
    .sort({ totalPoints: -1, firstSubmission: 1 })
    .limit(limit)
    .select('user totalPoints groupPoints podiumPoints bonusPoints rankingPosition');
};

// 🔥 MÉTODO ESTÁTICO: Limpar cálculos (para testes) (NOVO)
betSchema.statics.resetAllCalculations = async function() {
  console.log('🔄 LIMPANDO TODOS OS CÁLCULOS...');
  
  const result = await this.updateMany(
    { hasSubmitted: true },
    {
      $set: {
        'groupMatches.$[].points': 0,
        'groupMatches.$[].processedAt': null,
        'podium.points': 0,
        'podium.calculated': false,
        'groupPoints': 0,
        'podiumPoints': 0,
        'totalPoints': 0,
        'bonusPoints': 0,
        'isCalculated': false,
        'lastPointsCalculation': null
      }
    }
  );
  
  console.log(`✅ ${result.modifiedCount} palpites resetados`);
  return result.modifiedCount;
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
betSchema.index({ lastPointsCalculation: -1 });

module.exports = mongoose.model('Bet', betSchema);
