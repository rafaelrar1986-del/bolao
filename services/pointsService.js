const Match = require('../models/Match');
const Bet = require('../models/Bet');

class PointsService {
  
  // ======================
  // 🎯 PROCESSAR PONTOS DE UMA PARTIDA
  // ======================
  static async processMatchPoints(matchId) {
    try {
      console.log(`🎯 [PointsService] Processando pontos para partida ${matchId}...`);
      
      // Buscar partida finalizada
      const match = await Match.findOne({ matchId, status: 'finished' });
      
      if (!match) {
        throw new Error(`Partida ${matchId} não encontrada ou não está finalizada`);
      }

      console.log(`📊 Partida: ${match.teamA} ${match.scoreA}-${match.scoreB} ${match.teamB}`);
      console.log(`🏆 Vencedor: ${match.winner === 'teamA' ? match.teamA : match.winner === 'teamB' ? match.teamB : 'Empate'}`);

      // Buscar todos os palpites para esta partida
      const bets = await Bet.find({ 
        'groupMatches.matchId': matchId,
        hasSubmitted: true 
      }).populate('user', 'name email');

      console.log(`🔍 Encontrados ${bets.length} palpites para a partida ${matchId}`);

      let processedCount = 0;
      let pointsAwarded = 0;
      const results = [];

      // Processar cada palpite
      for (const bet of bets) {
        try {
          const result = await bet.calculatePointsForMatch(matchId, match);
          
          if (result.updated) {
            processedCount++;
            pointsAwarded += result.points;
          }
          
          results.push({
            userId: bet.user._id,
            userName: bet.user.name,
            points: result.points,
            updated: result.updated,
            previousPoints: result.previousPoints
          });
          
          console.log(`✅ ${bet.user.name}: ${result.points} ponto(s)`);
        } catch (betError) {
          console.error(`❌ Erro ao processar ${bet.user.name}:`, betError);
          results.push({
            userId: bet.user._id,
            userName: bet.user.name,
            error: betError.message
          });
        }
      }

      // Atualizar ranking geral se houver mudanças
      if (processedCount > 0) {
        await Bet.updateRanking();
        console.log(`🏆 Ranking atualizado para ${processedCount} participantes`);
      }

      const summary = {
        matchId,
        match: `${match.teamA} vs ${match.teamB}`,
        result: `${match.scoreA}-${match.scoreB}`,
        winner: match.winner,
        totalBets: bets.length,
        processedBets: processedCount,
        totalPointsAwarded: pointsAwarded,
        successRate: bets.length > 0 ? ((results.filter(r => r.points > 0).length / bets.length) * 100).toFixed(1) : 0
      };

      console.log(`✅ [PointsService] Processamento concluído:`, summary);

      return {
        success: true,
        summary,
        details: results
      };

    } catch (error) {
      console.error('❌ [PointsService] ERRO NO PROCESSAMENTO:', error);
      throw error;
    }
  }

  // ======================
  // 🏅 PROCESSAR PÓDIO FINAL
  // ======================
  static async processPodiumPoints(podiumData) {
    try {
      console.log('🏅 [PointsService] Processando pontos do pódio...');
      
      const { first, second, third } = podiumData;

      // Validar pódio
      if (!first || !second || !third) {
        throw new Error('Pódio incompleto. São necessários: first, second, third');
      }

      // Verificar times diferentes
      const podiumTeams = [first, second, third];
      const uniqueTeams = [...new Set(podiumTeams)];
      
      if (uniqueTeams.length !== 3) {
        throw new Error('Times do pódio devem ser diferentes');
      }

      console.log(`🎯 Pódio definido: 1º ${first}, 2º ${second}, 3º ${third}`);

      // Buscar todas as partidas finalizadas
      const finishedMatches = await Match.find({ status: 'finished' });
      
      if (finishedMatches.length === 0) {
        console.warn('⚠️ Nenhuma partida finalizada encontrada');
      }

      const actualPodium = { first, second, third };

      // Recalcular todos os pontos incluindo o pódio
      const recalculationResult = await Bet.recalculateAllPoints(finishedMatches, actualPodium);
      
      // Atualizar ranking
      const rankedCount = await Bet.updateRanking();

      const summary = {
        podium: actualPodium,
        finishedMatches: finishedMatches.length,
        participants: recalculationResult.totalBets,
        updatedParticipants: recalculationResult.updatedBets,
        podiumPointsAwarded: await this.calculatePodiumPointsDistribution(actualPodium)
      };

      console.log(`✅ [PointsService] Pódio processado:`, summary);

      return {
        success: true,
        summary,
        details: recalculationResult
      };

    } catch (error) {
      console.error('❌ [PointsService] ERRO AO PROCESSAR PÓDIO:', error);
      throw error;
    }
  }

  // ======================
  // 📊 CALCULAR DISTRIBUIÇÃO DE PONTOS DO PÓDIO
  // ======================
  static async calculatePodiumPointsDistribution(actualPodium) {
    try {
      const bets = await Bet.find({ hasSubmitted: true }).populate('user', 'name');
      
      const distribution = {
        champion: 0,    // 10 pontos
        vice: 0,        // 7 pontos  
        third: 0,       // 4 pontos
        total: 0
      };

      for (const bet of bets) {
        let points = 0;
        
        if (bet.podium.first === actualPodium.first) {
          points += 10;
          distribution.champion++;
        }
        if (bet.podium.second === actualPodium.second) {
          points += 7;
          distribution.vice++;
        }
        if (bet.podium.third === actualPodium.third) {
          points += 4;
          distribution.third++;
        }
        
        distribution.total += points;
      }

      return distribution;
    } catch (error) {
      console.error('❌ Erro ao calcular distribuição do pódio:', error);
      return { champion: 0, vice: 0, third: 0, total: 0 };
    }
  }

  // ======================
  // 🔄 RECALCULAR TODOS OS PONTOS
  // ======================
  static async recalculateAllPoints() {
    try {
      console.log('🔄 [PointsService] Recalculando todos os pontos...');
      
      // Buscar todas as partidas finalizadas
      const finishedMatches = await Match.find({ status: 'finished' });
      const totalMatches = finishedMatches.length;
      
      console.log(`📊 ${totalMatches} partidas finalizadas encontradas`);

      if (totalMatches === 0) {
        return {
          success: true,
          message: 'Nenhuma partida finalizada para calcular pontos',
          summary: {
            finishedMatches: 0,
            participants: 0,
            updatedParticipants: 0
          }
        };
      }

      // Recalcular pontos de todos os palpites
      const recalculationResult = await Bet.recalculateAllPoints(finishedMatches);
      
      // Atualizar ranking
      const rankedCount = await Bet.updateRanking();

      const summary = {
        finishedMatches: totalMatches,
        participants: recalculationResult.totalBets,
        updatedParticipants: recalculationResult.updatedBets,
        updatedItems: recalculationResult.updatedItems,
        rankingUpdated: rankedCount
      };

      console.log(`✅ [PointsService] Recalculo completo:`, summary);

      return {
        success: true,
        summary,
        details: recalculationResult
      };

    } catch (error) {
      console.error('❌ [PointsService] ERRO NO RECALCULO GERAL:', error);
      throw error;
    }
  }

  // ======================
  // 📈 OBTER ESTATÍSTICAS DE PONTUAÇÃO
  // ======================
  static async getPointsStatistics() {
    try {
      console.log('📈 [PointsService] Gerando estatísticas de pontuação...');
      
      const [
        globalStats,
        topParticipants,
        finishedMatches,
        pointsDistribution
      ] = await Promise.all([
        Bet.getGlobalStats(),
        Bet.getTopParticipants(10),
        Match.find({ status: 'finished' }),
        this.getPointsDistribution()
      ]);

      // Calcular estatísticas de acertos
      const totalPossiblePoints = finishedMatches.length; // 1 ponto por jogo
      const averageAccuracy = globalStats.totalParticipants > 0 
        ? (globalStats.avgGroupPoints / totalPossiblePoints) * 100 
        : 0;

      const stats = {
        participants: globalStats.totalParticipants,
        finishedMatches: finishedMatches.length,
        totalPoints: globalStats.totalPoints,
        averagePoints: globalStats.averagePoints,
        averageAccuracy: Math.round(averageAccuracy * 100) / 100,
        maxPoints: globalStats.pointsStats.maxPoints || 0,
        topParticipants: topParticipants.map(p => ({
          name: p.user.name,
          points: p.totalPoints,
          position: p.rankingPosition
        })),
        pointsDistribution,
        lastUpdate: new Date().toISOString()
      };

      console.log(`✅ [PointsService] Estatísticas geradas: ${stats.participants} participantes`);

      return stats;

    } catch (error) {
      console.error('❌ [PointsService] ERRO AO BUSCAR ESTATÍSTICAS:', error);
      throw error;
    }
  }

  // ======================
  // 📊 DISTRIBUIÇÃO DE PONTOS
  // ======================
  static async getPointsDistribution() {
    try {
      const distribution = await Bet.aggregate([
        { $match: { hasSubmitted: true } },
        {
          $bucket: {
            groupBy: "$totalPoints",
            boundaries: [0, 10, 20, 30, 40, 50, 100],
            default: "50+",
            output: {
              count: { $sum: 1 },
              participants: { $push: "$user" }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      return distribution;
    } catch (error) {
      console.error('❌ Erro ao buscar distribuição de pontos:', error);
      return [];
    }
  }

  // ======================
  // 🎮 SIMULAR PONTUAÇÃO
  // ======================
  static async simulatePoints(scenario = {}) {
    try {
      console.log('🎮 [PointsService] Simulando pontuação...');
      
      const {
        matches = [],
        podium = null,
        includeBonus = false
      } = scenario;

      // Se não fornecer partidas, usar as finalizadas
      const actualMatches = matches.length > 0 
        ? matches 
        : await Match.find({ status: 'finished' });

      const bets = await Bet.find({ hasSubmitted: true }).populate('user', 'name');
      
      const simulationResults = bets.map(bet => {
        const simulated = bet.simulatePoints(actualMatches, podium);
        
        return {
          user: {
            id: bet.user._id,
            name: bet.user.name
          },
          currentPoints: {
            total: bet.totalPoints,
            group: bet.groupPoints,
            podium: bet.podiumPoints,
            bonus: bet.bonusPoints
          },
          simulatedPoints: {
            total: simulated.totalPoints,
            group: simulated.groupPoints,
            podium: simulated.podiumPoints,
            bonus: includeBonus ? bet.bonusPoints : 0,
            correctBets: simulated.correctBets
          },
          difference: simulated.totalPoints - bet.totalPoints,
          accuracy: simulated.correctBets > 0 
            ? (simulated.correctBets / simulated.totalMatches) * 100 
            : 0
        };
      });

      // Ordenar por pontuação simulada
      simulationResults.sort((a, b) => b.simulatedPoints.total - a.simulatedPoints.total);

      const summary = {
        totalParticipants: simulationResults.length,
        currentAverage: bets.reduce((sum, bet) => sum + bet.totalPoints, 0) / bets.length,
        simulatedAverage: simulationResults.reduce((sum, result) => sum + result.simulatedPoints.total, 0) / simulationResults.length,
        highestScore: simulationResults[0]?.simulatedPoints.total || 0,
        perfectScores: simulationResults.filter(result => result.simulatedPoints.group === actualMatches.length).length,
        matchesInSimulation: actualMatches.length,
        podiumIncluded: !!podium
      };

      return {
        success: true,
        summary,
        results: simulationResults
      };

    } catch (error) {
      console.error('❌ [PointsService] ERRO NA SIMULAÇÃO:', error);
      throw error;
    }
  }

  // ======================
  // 🔧 FERRAMENTAS DE ADMIN
  // ======================

  // Resetar todos os cálculos (apenas desenvolvimento)
  static async resetAllCalculations() {
    try {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Reset não permitido em produção');
      }

      console.log('🔧 [PointsService] Resetando todos os cálculos...');
      
      const resetCount = await Bet.resetAllCalculations();
      
      console.log(`✅ ${resetCount} cálculos resetados`);

      return {
        success: true,
        resetCount,
        message: `${resetCount} cálculos resetados com sucesso`
      };

    } catch (error) {
      console.error('❌ [PointsService] ERRO NO RESET:', error);
      throw error;
    }
  }

  // Verificar integridade dos dados
  static async checkDataIntegrity() {
    try {
      console.log('🔍 [PointsService] Verificando integridade dos dados...');
      
      const bets = await Bet.find({ hasSubmitted: true }).populate('user', 'name');
      
      const integrityReport = {
        totalBets: bets.length,
        errors: [],
        warnings: [],
        stats: {
          calculatedBets: 0,
          inconsistentPoints: 0,
          missingPodium: 0
        }
      };

      for (const bet of bets) {
        // Verificar consistência dos pontos
        const calculatedTotal = bet.groupPoints + bet.podiumPoints + bet.bonusPoints;
        if (Math.abs(calculatedTotal - bet.totalPoints) > 0.1) {
          integrityReport.errors.push({
            user: bet.user.name,
            issue: 'Pontos inconsistentes',
            expected: calculatedTotal,
            actual: bet.totalPoints
          });
          integrityReport.stats.inconsistentPoints++;
        }

        // Verificar se está calculado
        if (bet.isCalculated) {
          integrityReport.stats.calculatedBets++;
        }

        // Verificar pódio
        if (!bet.podium.first || !bet.podium.second || !bet.podium.third) {
          integrityReport.warnings.push({
            user: bet.user.name,
            issue: 'Pódio incompleto'
          });
          integrityReport.stats.missingPodium++;
        }
      }

      console.log(`✅ [PointsService] Verificação de integridade concluída: ${integrityReport.errors.length} erros, ${integrityReport.warnings.length} avisos`);

      return integrityReport;

    } catch (error) {
      console.error('❌ [PointsService] ERRO NA VERIFICAÇÃO:', error);
      throw error;
    }
  }
}

module.exports = PointsService;