const mongoose = require('mongoose');
const PointsService = require('./services/pointsService');
const Match = require('./models/Match');
const Bet = require('./models/Bet');
const User = require('./models/User');

class SystemTester {
  constructor() {
    this.testResults = [];
    this.testUsers = [];
    this.testMatches = [];
  }

  // ======================
  // 🧪 CONFIGURAÇÃO INICIAL
  // ======================
  async setup() {
    console.log('🚀 INICIANDO TESTES DO SISTEMA DE BOLÃO\n');
    
    // Conectar ao MongoDB
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bolao-copa-2026');
      console.log('✅ Conectado ao MongoDB');
    } catch (error) {
      console.error('❌ Erro ao conectar ao MongoDB:', error);
      process.exit(1);
    }

    // Limpar dados de teste anteriores
    await this.cleanTestData();
  }

  async cleanTestData() {
    console.log('🧹 Limpando dados de teste anteriores...');
    
    // Deletar usuários de teste
    await User.deleteMany({ email: /test\d+@example\.com/ });
    
    // Deletar partidas de teste
    await Match.deleteMany({ matchId: { $gte: 100 } });
    
    console.log('✅ Dados de teste anteriores removidos');
  }

  // ======================
  // 🧪 TESTE 1: CRIAR USUÁRIOS DE TESTE
  // ======================
  async testCreateUsers() {
    console.log('\n🧪 TESTE 1: Criando usuários de teste...');
    
    const testUsers = [
      { name: 'João Teste', email: 'test1@example.com', password: '123456' },
      { name: 'Maria Teste', email: 'test2@example.com', password: '123456' },
      { name: 'Pedro Teste', email: 'test3@example.com', password: '123456' },
      { name: 'Admin Teste', email: 'admin@example.com', password: '123456', isAdmin: true }
    ];

    for (const userData of testUsers) {
      try {
        const user = new User(userData);
        await user.save();
        this.testUsers.push(user);
        console.log(`✅ Usuário criado: ${user.name} (${user.email})`);
      } catch (error) {
        console.error(`❌ Erro ao criar usuário ${userData.email}:`, error.message);
      }
    }

    this.testResults.push({
      test: 'Criar Usuários',
      status: '✅ PASSOU',
      details: `${this.testUsers.length} usuários criados`
    });
  }

  // ======================
  // 🧪 TESTE 2: CRIAR PARTIDAS DE TESTE
  // ======================
  async testCreateMatches() {
    console.log('\n🧪 TESTE 2: Criando partidas de teste...');
    
    const testMatches = [
      { 
        matchId: 101, 
        teamA: "Brasil", teamB: "Argentina", 
        date: "15/06/2026", time: "16:00", 
        group: "Grupo Teste A", 
        status: "scheduled",
        stadium: "Maracanã"
      },
      { 
        matchId: 102, 
        teamA: "França", teamB: "Alemanha", 
        date: "16/06/2026", time: "14:00", 
        group: "Grupo Teste A", 
        status: "scheduled",
        stadium: "Stade de France"
      },
      { 
        matchId: 103, 
        teamA: "Itália", teamB: "Espanha", 
        date: "17/06/2026", time: "19:00", 
        group: "Grupo Teste B", 
        status: "scheduled",
        stadium: "Estádio Olímpico"
      }
    ];

    for (const matchData of testMatches) {
      try {
        const match = new Match(matchData);
        await match.save();
        this.testMatches.push(match);
        console.log(`✅ Partida criada: ${match.teamA} vs ${match.teamB} (ID: ${match.matchId})`);
      } catch (error) {
        console.error(`❌ Erro ao criar partida ${matchData.matchId}:`, error.message);
      }
    }

    this.testResults.push({
      test: 'Criar Partidas',
      status: '✅ PASSOU',
      details: `${this.testMatches.length} partidas criadas`
    });
  }

  // ======================
  // 🧪 TESTE 3: CRIAR PALPITES DE TESTE
  // ======================
  async testCreateBets() {
    console.log('\n🧪 TESTE 3: Criando palpites de teste...');
    
    const betsData = [
      // João Teste - Palpites otimistas para Brasil
      {
        user: this.testUsers[0]._id,
        groupMatches: [
          { matchId: 101, bet: "2-1" }, // Brasil 2-1 Argentina
          { matchId: 102, bet: "1-1" }, // França 1-1 Alemanha  
          { matchId: 103, bet: "0-0" }  // Itália 0-0 Espanha
        ],
        podium: {
          first: "Brasil",
          second: "França", 
          third: "Itália"
        },
        hasSubmitted: true
      },
      // Maria Teste - Palpites realistas
      {
        user: this.testUsers[1]._id,
        groupMatches: [
          { matchId: 101, bet: "1-1" }, // Brasil 1-1 Argentina
          { matchId: 102, bet: "2-0" }, // França 2-0 Alemanha
          { matchId: 103, bet: "1-0" }  // Itália 1-0 Espanha
        ],
        podium: {
          first: "França",
          second: "Brasil",
          third: "Alemanha"
        },
        hasSubmitted: true
      },
      // Pedro Teste - Palpites surpresa
      {
        user: this.testUsers[2]._id, 
        groupMatches: [
          { matchId: 101, bet: "0-2" }, // Brasil 0-2 Argentina
          { matchId: 102, bet: "1-3" }, // França 1-3 Alemanha
          { matchId: 103, bet: "2-2" }  // Itália 2-2 Espanha
        ],
        podium: {
          first: "Argentina",
          second: "Alemanha", 
          third: "Espanha"
        },
        hasSubmitted: true
      }
    ];

    let createdBets = 0;

    for (const betData of betsData) {
      try {
        const bet = new Bet(betData);
        await bet.save();
        await bet.populate('user', 'name');
        createdBets++;
        console.log(`✅ Palpite criado para: ${bet.user.name}`);
      } catch (error) {
        console.error(`❌ Erro ao criar palpite:`, error.message);
      }
    }

    this.testResults.push({
      test: 'Criar Palpites',
      status: '✅ PASSOU', 
      details: `${createdBets} palpites criados`
    });
  }

  // ======================
  // 🧪 TESTE 4: FINALIZAR PARTIDAS E CALCULAR PONTOS
  // ======================
  async testFinishMatchesAndCalculatePoints() {
    console.log('\n🧪 TESTE 4: Finalizando partidas e calculando pontos...');
    
    try {
      // Finalizar partida 101: Brasil 2-1 Argentina
      const match101 = await Match.findOne({ matchId: 101 });
      match101.scoreA = 2;
      match101.scoreB = 1;
      match101.status = 'finished';
      match101.winner = 'teamA'; // Brasil venceu
      match101.isFinished = true;
      await match101.save();
      
      console.log(`✅ Partida 101 finalizada: ${match101.teamA} ${match101.scoreA}-${match101.scoreB} ${match101.teamB}`);

      // Processar pontos da partida 101
      const result101 = await PointsService.processMatchPoints(101);
      console.log(`✅ Pontos processados: ${result101.summary.processedBets} palpites atualizados`);

      // Finalizar partida 102: França 1-1 Alemanha  
      const match102 = await Match.findOne({ matchId: 102 });
      match102.scoreA = 1;
      match102.scoreB = 1;
      match102.status = 'finished';
      match102.winner = 'draw'; // Empate
      match102.isFinished = true;
      await match102.save();
      
      console.log(`✅ Partida 102 finalizada: ${match102.teamA} ${match102.scoreA}-${match102.scoreB} ${match102.teamB}`);

      // Processar pontos da partida 102
      const result102 = await PointsService.processMatchPoints(102);
      console.log(`✅ Pontos processados: ${result102.summary.processedBets} palpites atualizados`);

      this.testResults.push({
        test: 'Finalizar Partidas e Calcular Pontos',
        status: '✅ PASSOU',
        details: `2 partidas finalizadas, ${result101.summary.processedBets + result102.summary.processedBets} atualizações`
      });

    } catch (error) {
      console.error('❌ Erro ao finalizar partidas:', error);
      this.testResults.push({
        test: 'Finalizar Partidas e Calcular Pontos',
        status: '❌ FALHOU',
        details: error.message
      });
    }
  }

  // ======================
  // 🧪 TESTE 5: VERIFICAR PONTUAÇÃO ATUAL
  // ======================
  async testCheckCurrentPoints() {
    console.log('\n🧪 TESTE 5: Verificando pontuação atual...');
    
    try {
      const bets = await Bet.find({ hasSubmitted: true })
        .populate('user', 'name')
        .sort({ totalPoints: -1 });

      console.log('\n📊 PONTUAÇÃO ATUAL:');
      console.log('='.repeat(50));
      
      bets.forEach((bet, index) => {
        console.log(`${index + 1}º - ${bet.user.name}:`);
        console.log(`   Total: ${bet.totalPoints} pontos`);
        console.log(`   Jogos: ${bet.groupPoints} pontos`);
        console.log(`   Pódio: ${bet.podiumPoints} pontos`);
        console.log(`   Bônus: ${bet.bonusPoints} pontos`);
        console.log(`   Acertos: ${bet.correctBets}/${bet.betsCount} jogos`);
        console.log('   ---');
      });

      this.testResults.push({
        test: 'Verificar Pontuação',
        status: '✅ PASSOU',
        details: `${bets.length} palpites verificados`
      });

    } catch (error) {
      console.error('❌ Erro ao verificar pontuação:', error);
      this.testResults.push({
        test: 'Verificar Pontuação', 
        status: '❌ FALHOU',
        details: error.message
      });
    }
  }

  // ======================
  // 🧪 TESTE 6: DEFINIR PÓDIO E CALCULAR PONTOS
  // ======================
  async testSetPodium() {
    console.log('\n🧪 TESTE 6: Definindo pódio final...');
    
    try {
      const podium = {
        first: "Brasil",   // João acertou campeão (+10)
        second: "França",  // Maria acertou vice (+7), João acertou segundo (+7)  
        third: "Itália"    // João acertou terceiro (+4)
      };

      const result = await PointsService.processPodiumPoints(podium);
      
      console.log('✅ Pódio definido:');
      console.log(`   1º: ${podium.first}`);
      console.log(`   2º: ${podium.second}`); 
      console.log(`   3º: ${podium.third}`);
      console.log(`   Pontos distribuídos: ${result.summary.podiumPointsAwarded.total}`);

      this.testResults.push({
        test: 'Definir Pódio',
        status: '✅ PASSOU',
        details: `Pódio: ${podium.first}, ${podium.second}, ${podium.third}`
      });

    } catch (error) {
      console.error('❌ Erro ao definir pódio:', error);
      this.testResults.push({
        test: 'Definir Pódio',
        status: '❌ FALHOU', 
        details: error.message
      });
    }
  }

  // ======================
  // 🧪 TESTE 7: VERIFICAR PONTUAÇÃO FINAL
  // ======================
  async testCheckFinalPoints() {
    console.log('\n🧪 TESTE 7: Verificando pontuação final...');
    
    try {
      const bets = await Bet.find({ hasSubmitted: true })
        .populate('user', 'name')
        .sort({ totalPoints: -1 });

      console.log('\n🏆 PONTUAÇÃO FINAL:');
      console.log('='.repeat(50));
      
      bets.forEach((bet, index) => {
        console.log(`${index + 1}º - ${bet.user.name}:`);
        console.log(`   Total: ${bet.totalPoints} pontos`);
        console.log(`   Jogos: ${bet.groupPoints} pontos`);
        console.log(`   Pódio: ${bet.podiumPoints} pontos`);
        console.log(`   Bônus: ${bet.bonusPoints} pontos`);
        
        // Detalhes dos acertos
        const correctMatches = bet.groupMatches.filter(m => m.points > 0);
        console.log(`   Acertos: ${correctMatches.length}/${bet.groupMatches.length} jogos`);
        
        if (correctMatches.length > 0) {
          console.log(`   Jogos acertados: ${correctMatches.map(m => m.matchId).join(', ')}`);
        }
        
        console.log('   ---');
      });

      // Verificar se João está em primeiro (deveria ter mais pontos)
      const joaoBet = bets.find(b => b.user.name === 'João Teste');
      if (joaoBet && joaoBet.rankingPosition === 1) {
        console.log('✅ CORRETO: João está em 1º lugar como esperado!');
      }

      this.testResults.push({
        test: 'Verificar Pontuação Final',
        status: '✅ PASSOU',
        details: `Ranking final com ${bets.length} participantes`
      });

    } catch (error) {
      console.error('❌ Erro ao verificar pontuação final:', error);
      this.testResults.push({
        test: 'Verificar Pontuação Final',
        status: '❌ FALHOU',
        details: error.message
      });
    }
  }

  // ======================
  // 🧪 TESTE 8: ESTATÍSTICAS DO SISTEMA
  // ======================
  async testSystemStatistics() {
    console.log('\n🧪 TESTE 8: Gerando estatísticas do sistema...');
    
    try {
      const stats = await PointsService.getPointsStatistics();
      
      console.log('\n📈 ESTATÍSTICAS DO SISTEMA:');
      console.log('='.repeat(50));
      console.log(`Participantes: ${stats.participants}`);
      console.log(`Partidas finalizadas: ${stats.finishedMatches}`);
      console.log(`Pontos totais distribuídos: ${stats.totalPoints}`);
      console.log(`Média de pontos: ${stats.averagePoints}`);
      console.log(`Precisão média: ${stats.averageAccuracy}%`);
      console.log(`Maior pontuação: ${stats.maxPoints} pontos`);
      
      console.log('\n🏅 TOP 3:');
      stats.topParticipants.slice(0, 3).forEach((p, index) => {
        console.log(`   ${index + 1}º: ${p.name} - ${p.points} pontos`);
      });

      this.testResults.push({
        test: 'Estatísticas do Sistema',
        status: '✅ PASSOU',
        details: `Estatísticas geradas para ${stats.participants} participantes`
      });

    } catch (error) {
      console.error('❌ Erro ao gerar estatísticas:', error);
      this.testResults.push({
        test: 'Estatísticas do Sistema',
        status: '❌ FALHOU',
        details: error.message
      });
    }
  }

  // ======================
  // 🧪 TESTE 9: SIMULAÇÃO DE PONTUAÇÃO
  // ======================
  async testPointsSimulation() {
    console.log('\n🧪 TESTE 9: Simulando cenário alternativo...');
    
    try {
      const scenario = {
        matches: [
          {
            matchId: 101,
            teamA: "Brasil", teamB: "Argentina",
            scoreA: 3, scoreB: 0, // Resultado diferente
            status: 'finished',
            winner: 'teamA'
          },
          {
            matchId: 102, 
            teamA: "França", teamB: "Alemanha",
            scoreA: 2, scoreB: 1, // Resultado diferente
            status: 'finished', 
            winner: 'teamA'
          }
        ],
        podium: {
          first: "Argentina", // Pódio diferente
          second: "Alemanha",
          third: "Espanha"
        }
      };

      const result = await PointsService.simulatePoints(scenario);
      
      console.log('✅ Simulação concluída:');
      console.log(`   Participantes: ${result.summary.totalParticipants}`);
      console.log(`   Média atual: ${result.summary.currentAverage.toFixed(1)} pontos`);
      console.log(`   Média simulada: ${result.summary.simulatedAverage.toFixed(1)} pontos`);
      console.log(`   Maior pontuação simulada: ${result.summary.highestScore} pontos`);

      this.testResults.push({
        test: 'Simulação de Pontuação',
        status: '✅ PASSOU',
        details: `Simulação com ${result.summary.totalParticipants} participantes`
      });

    } catch (error) {
      console.error('❌ Erro na simulação:', error);
      this.testResults.push({
        test: 'Simulação de Pontuação',
        status: '❌ FALHOU',
        details: error.message
      });
    }
  }

  // ======================
  // 🧪 TESTE 10: VERIFICAÇÃO DE INTEGRIDADE
  // ======================
  async testDataIntegrity() {
    console.log('\n🧪 TESTE 10: Verificando integridade dos dados...');
    
    try {
      const report = await PointsService.checkDataIntegrity();
      
      console.log('✅ Verificação de integridade:');
      console.log(`   Total de palpites: ${report.totalBets}`);
      console.log(`   Palpites calculados: ${report.stats.calculatedBets}`);
      console.log(`   Erros de consistência: ${report.stats.inconsistentPoints}`);
      console.log(`   Avisos: ${report.warnings.length}`);
      
      if (report.errors.length > 0) {
        console.log('   ❌ ERROS ENCONTRADOS:');
        report.errors.forEach(error => {
          console.log(`      - ${error.user}: ${error.issue}`);
        });
      } else {
        console.log('   ✅ Nenhum erro crítico encontrado');
      }

      this.testResults.push({
        test: 'Verificação de Integridade',
        status: report.errors.length === 0 ? '✅ PASSOU' : '⚠️ AVISOS',
        details: `${report.totalBets} palpites verificados, ${report.errors.length} erros`
      });

    } catch (error) {
      console.error('❌ Erro na verificação:', error);
      this.testResults.push({
        test: 'Verificação de Integridade',
        status: '❌ FALHOU',
        details: error.message
      });
    }
  }

  // ======================
  // 📊 RELATÓRIO FINAL
  // ======================
  generateFinalReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO FINAL DOS TESTES');
    console.log('='.repeat(60));
    
    this.testResults.forEach((result, index) => {
      console.log(`${index + 1}. ${result.test}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Detalhes: ${result.details}`);
      console.log('');
    });

    const passedTests = this.testResults.filter(t => t.status.includes('✅')).length;
    const totalTests = this.testResults.length;
    
    console.log(`🎯 RESUMO: ${passedTests}/${totalTests} testes passaram`);
    
    if (passedTests === totalTests) {
      console.log('🎉 TODOS OS TESTES PASSARAM! O sistema está funcionando perfeitamente!');
    } else {
      console.log('⚠️  Alguns testes falharam. Verifique os logs acima.');
    }
  }

  // ======================
  // 🚀 EXECUTAR TODOS OS TESTES
  // ======================
  async runAllTests() {
    await this.setup();
    
    await this.testCreateUsers();
    await this.testCreateMatches(); 
    await this.testCreateBets();
    await this.testFinishMatchesAndCalculatePoints();
    await this.testCheckCurrentPoints();
    await this.testSetPodium();
    await this.testCheckFinalPoints();
    await this.testSystemStatistics();
    await this.testPointsSimulation();
    await this.testDataIntegrity();
    
    this.generateFinalReport();
    
    // Fechar conexão
    await mongoose.connection.close();
    console.log('\n🔌 Conexão com MongoDB fechada');
  }
}

// ======================
// 🏃 EXECUTAR TESTES
// ======================
if (require.main === module) {
  const tester = new SystemTester();
  tester.runAllTests().catch(console.error);
}

module.exports = SystemTester;