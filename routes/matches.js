const express = require('express');
const Match = require('../models/Match');
const Bet = require('../models/Bet');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

// ======================
// 📋 LISTAR TODOS OS JOGOS
// ======================
router.get('/', async (req, res) => {
  try {
    console.log('📋 Buscando todos os jogos...');
    
    const matches = await Match.find().sort({ date: 1, time: 1, matchId: 1 });
    
    console.log(`✅ Encontrados ${matches.length} jogos`);

    res.json({
      success: true,
      count: matches.length,
      data: matches,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erro ao buscar jogos:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao carregar lista de jogos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ======================
// 🔍 BUSCAR JOGO POR ID
// ======================
router.get('/:id', async (req, res) => {
  try {
    const matchId = req.params.id;
    console.log(`🔍 Buscando jogo ID: ${matchId}`);

    // Tentar buscar por matchId (numérico) ou _id (MongoDB ObjectId)
    let match;
    if (/^\d+$/.test(matchId)) {
      // Se for número, busca por matchId
      match = await Match.findOne({ matchId: parseInt(matchId) });
    } else {
      // Se não for número, busca por _id
      match = await Match.findById(matchId);
    }
    
    if (!match) {
      console.log(`❌ Jogo não encontrado: ${matchId}`);
      return res.status(404).json({ 
        success: false,
        message: 'Jogo não encontrado' 
      });
    }

    console.log(`✅ Jogo encontrado: ${match.teamA} vs ${match.teamB}`);

    res.json({
      success: true,
      data: match
    });
  } catch (error) {
    console.error('❌ Erro ao buscar jogo:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        success: false,
        message: 'ID do jogo inválido' 
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Erro ao buscar jogo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ======================
// 📊 ESTATÍSTICAS DOS JOGOS
// ======================
router.get('/stats/summary', async (req, res) => {
  try {
    console.log('📊 Gerando estatísticas dos jogos...');
    
    const totalMatches = await Match.countDocuments();
    const scheduledMatches = await Match.countDocuments({ status: 'scheduled' });
    const inProgressMatches = await Match.countDocuments({ status: 'in_progress' });
    const finishedMatches = await Match.countDocuments({ status: 'finished' });
    
    // Próximos jogos (agendados)
    const nextMatches = await Match.find({ status: 'scheduled' })
      .sort({ date: 1, time: 1 })
      .limit(5)
      .select('matchId teamA teamB date time group');

    const stats = {
      total: totalMatches,
      scheduled: scheduledMatches,
      inProgress: inProgressMatches,
      finished: finishedMatches,
      nextMatches: nextMatches
    };

    console.log(`✅ Estatísticas: ${totalMatches} jogos totais`);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao carregar estatísticas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ======================
// 📅 PRÓXIMOS JOGOS
// ======================
router.get('/upcoming/next', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    console.log(`📅 Buscando próximos ${limit} jogos...`);

    const upcomingMatches = await Match.find({ 
      $or: [
        { status: 'scheduled' },
        { status: 'in_progress' }
      ]
    })
    .sort({ date: 1, time: 1 })
    .limit(limit);

    res.json({
      success: true,
      count: upcomingMatches.length,
      data: upcomingMatches
    });
  } catch (error) {
    console.error('❌ Erro ao buscar próximos jogos:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao carregar próximos jogos'
    });
  }
});

// ======================
// 🎯 INICIALIZAR JOGOS (APENAS ADMIN/DESENVOLVIMENTO)
// ======================
router.post('/initialize', protect, admin, async (req, res) => {
  try {
    // Verificar se já existem jogos
    const existingMatches = await Match.countDocuments();
    
    if (existingMatches > 0 && process.env.NODE_ENV === 'production') {
      return res.status(400).json({ 
        success: false,
        message: 'Jogos já inicializados. Use a rota de reset apenas em desenvolvimento.'
      });
    }

    console.log('🎯 Inicializando jogos da Copa 2026...');

    const initialMatches = [
      // Grupo A
      { 
        matchId: 1, 
        teamA: "Brasil", teamB: "Croácia", 
        date: "13/06/2026", time: "16:00", 
        group: "Grupo A", 
        status: "scheduled",
        stadium: "Maracanã"
      },
      { 
        matchId: 2, 
        teamA: "Alemanha", teamB: "Japão", 
        date: "14/06/2026", time: "13:00", 
        group: "Grupo A", 
        status: "scheduled",
        stadium: "Allianz Arena"
      },
      { 
        matchId: 3, 
        teamA: "Brasil", teamB: "Alemanha", 
        date: "19/06/2026", time: "16:00", 
        group: "Grupo A", 
        status: "scheduled",
        stadium: "Estádio Nacional"
      },
      { 
        matchId: 4, 
        teamA: "Croácia", teamB: "Japão", 
        date: "20/06/2026", time: "13:00", 
        group: "Grupo A", 
        status: "scheduled",
        stadium: "Estádio Olímpico"
      },
      
      // Grupo B
      { 
        matchId: 5, 
        teamA: "Argentina", teamB: "Holanda", 
        date: "14/06/2026", time: "16:00", 
        group: "Grupo B", 
        status: "scheduled",
        stadium: "La Bombonera"
      },
      { 
        matchId: 6, 
        teamA: "França", teamB: "Estados Unidos", 
        date: "15/06/2026", time: "13:00", 
        group: "Grupo B", 
        status: "scheduled",
        stadium: "Stade de France"
      },
      { 
        matchId: 7, 
        teamA: "Argentina", teamB: "França", 
        date: "19/06/2026", time: "19:00", 
        group: "Grupo B", 
        status: "scheduled",
        stadium: "Estádio Monumental"
      },
      { 
        matchId: 8, 
        teamA: "Holanda", teamB: "Estados Unidos", 
        date: "20/06/2026", time: "16:00", 
        group: "Grupo B", 
        status: "scheduled",
        stadium: "Johan Cruyff Arena"
      },
    ];

    // Limpar jogos existentes e inserir novos
    if (existingMatches > 0) {
      console.log(`🔄 Removendo ${existingMatches} jogos existentes...`);
      await Match.deleteMany({});
    }

    const createdMatches = await Match.insertMany(initialMatches);

    console.log(`✅ ${createdMatches.length} jogos inicializados com sucesso!`);

    res.json({ 
      success: true,
      message: `${createdMatches.length} jogos inicializados com sucesso!`,
      count: createdMatches.length,
      data: createdMatches
    });

  } catch (error) {
    console.error('❌ Erro ao inicializar jogos:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao inicializar jogos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ======================
// 🔄 RESETAR JOGOS (APENAS DESENVOLVIMENTO)
// ======================
router.delete('/reset', protect, admin, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ 
        success: false,
        message: 'Reset de jogos não permitido em produção'
      });
    }

    const deletedCount = await Match.countDocuments();
    await Match.deleteMany({});

    console.log(`🔄 ${deletedCount} jogos removidos`);

    res.json({
      success: true,
      message: `${deletedCount} jogos removidos com sucesso`,
      count: deletedCount
    });
  } catch (error) {
    console.error('❌ Erro ao resetar jogos:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao resetar jogos'
    });
  }
});

// ======================
// 📍 JOGOS POR GRUPO
// ======================
router.get('/group/:groupName', async (req, res) => {
  try {
    const groupName = req.params.groupName;
    console.log(`📍 Buscando jogos do grupo: ${groupName}`);

    const matches = await Match.find({ 
      group: new RegExp(groupName, 'i') 
    }).sort({ date: 1, time: 1 });

    res.json({
      success: true,
      group: groupName,
      count: matches.length,
      data: matches
    });
  } catch (error) {
    console.error('❌ Erro ao buscar jogos por grupo:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao carregar jogos do grupo'
    });
  }
});

// ======================
// 👑 ROTAS ADMIN - GERENCIAR PARTIDAS (ATUALIZADAS)
// ======================

// 🔥 ADICIONAR NOVA PARTIDA (Admin) - ATUALIZADA
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const {
      matchId,
      teamA,
      teamB,
      date,
      time,
      group,
      stadium = 'A definir'
    } = req.body;

    console.log('👑 ADMIN - Adicionando nova partida:', { matchId, teamA, teamB });

    // Validar campos obrigatórios
    if (!matchId || !teamA || !teamB || !date || !time || !group) {
      return res.status(400).json({
        success: false,
        message: 'Todos os campos são obrigatórios: matchId, teamA, teamB, date, time, group'
      });
    }

    // Validar formato da data
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de data inválido. Use DD/MM/YYYY'
      });
    }

    // Validar formato do horário
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de horário inválido. Use HH:MM'
      });
    }

    // Verificar se matchId já existe
    const existingMatch = await Match.findOne({ matchId });
    if (existingMatch) {
      return res.status(409).json({
        success: false,
        message: `Já existe uma partida com o ID ${matchId}`
      });
    }

    // Criar nova partida
    const newMatch = await Match.create({
      matchId,
      teamA: teamA.trim(),
      teamB: teamB.trim(),
      date,
      time,
      group: group.trim(),
      stadium: stadium.trim(),
      status: 'scheduled'
    });

    console.log('✅ Partida criada com sucesso:', `${newMatch.teamA} vs ${newMatch.teamB}`);

    res.status(201).json({
      success: true,
      message: 'Partida adicionada com sucesso!',
      data: newMatch
    });

  } catch (error) {
    console.error('❌ ERRO AO ADICIONAR PARTIDA:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'ID da partida já existe'
      });
    }

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro ao adicionar partida'
    });
  }
});

// 🔥 EDITAR PARTIDA (Admin) - ATUALIZADA
router.put('/admin/edit/:id', protect, admin, async (req, res) => {
  try {
    const matchId = req.params.id;
    const updates = req.body;

    console.log('👑 ADMIN - Editando partida:', matchId);

    // Buscar partida
    let match;
    if (/^\d+$/.test(matchId)) {
      match = await Match.findOne({ matchId: parseInt(matchId) });
    } else {
      match = await Match.findById(matchId);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Partida não encontrada'
      });
    }

    // Atualizar campos permitidos
    const allowedUpdates = ['teamA', 'teamB', 'date', 'time', 'group', 'stadium', 'status', 'scoreA', 'scoreB'];
    const updateData = {};
    
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        updateData[field] = updates[field];
      }
    });

    // Se atualizar placar, verificar se finaliza a partida
    if (updateData.scoreA !== undefined || updateData.scoreB !== undefined) {
      if (updateData.scoreA !== null && updateData.scoreB !== null) {
        updateData.status = 'finished';
        updateData.isFinished = true;
        
        // Determinar vencedor automaticamente
        if (updateData.scoreA > updateData.scoreB) {
          updateData.winner = 'teamA';
        } else if (updateData.scoreB > updateData.scoreA) {
          updateData.winner = 'teamB';
        } else {
          updateData.winner = 'draw';
        }

        console.log(`🎯 Partida finalizada: ${updateData.scoreA}-${updateData.scoreB}, Vencedor: ${updateData.winner}`);
      }
    }

    const updatedMatch = await Match.findByIdAndUpdate(
      match._id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log('✅ Partida atualizada:', `${updatedMatch.teamA} vs ${updatedMatch.teamB}`);

    // Se a partida foi finalizada, processar os pontos automaticamente
    if (updatedMatch.status === 'finished') {
      console.log('🔄 Processando pontos para partida finalizada...');
      try {
        const affectedBets = await processMatchResults(updatedMatch.matchId);
        console.log(`✅ Pontos processados para ${affectedBets} palpites`);
      } catch (processingError) {
        console.error('⚠️ Erro ao processar pontos:', processingError);
        // Não falha a requisição principal, apenas loga o erro
      }
    }

    res.json({
      success: true,
      message: 'Partida atualizada com sucesso!',
      data: updatedMatch,
      pointsProcessed: updatedMatch.status === 'finished'
    });

  } catch (error) {
    console.error('❌ ERRO AO EDITAR PARTIDA:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro ao editar partida'
    });
  }
});

// 🔥 EXCLUIR PARTIDA (Admin) - ATUALIZADA
router.delete('/admin/delete/:id', protect, admin, async (req, res) => {
  try {
    const matchId = req.params.id;

    console.log('👑 ADMIN - Excluindo partida:', matchId);

    // Buscar partida
    let match;
    if (/^\d+$/.test(matchId)) {
      match = await Match.findOne({ matchId: parseInt(matchId) });
    } else {
      match = await Match.findById(matchId);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Partida não encontrada'
      });
    }

    // Verificar se há palpites para esta partida
    const betsWithThisMatch = await Bet.countDocuments({
      'groupMatches.matchId': match.matchId
    });

    if (betsWithThisMatch > 0) {
      return res.status(400).json({
        success: false,
        message: `Não é possível excluir esta partida. Existem ${betsWithThisMatch} palpites associados a ela.`
      });
    }

    await Match.findByIdAndDelete(match._id);

    console.log('✅ Partida excluída:', `${match.teamA} vs ${match.teamB}`);

    res.json({
      success: true,
      message: 'Partida excluída com sucesso!',
      deletedMatch: {
        matchId: match.matchId,
        teams: `${match.teamA} vs ${match.teamB}`,
        group: match.group
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO EXCLUIR PARTIDA:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao excluir partida'
    });
  }
});

// 🔥 LISTAR TODAS AS PARTIDAS (Admin - com mais detalhes) - ATUALIZADA
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    console.log('👑 ADMIN - Listando todas as partidas');
    
    const matches = await Match.find().sort({ matchId: 1 });

    // Adicionar estatísticas de palpites
    const matchesWithStats = await Promise.all(
      matches.map(async (match) => {
        const betsCount = await Bet.countDocuments({
          'groupMatches.matchId': match.matchId
        });

        const matchObj = match.toObject();
        return {
          ...matchObj,
          betsCount,
          hasBets: betsCount > 0,
          matchName: `${match.teamA} vs ${match.teamB}`
        };
      })
    );

    res.json({
      success: true,
      count: matchesWithStats.length,
      data: matchesWithStats
    });

  } catch (error) {
    console.error('❌ ERRO AO LISTAR PARTIDAS ADMIN:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao listar partidas'
    });
  }
});

// 🔥 ATUALIZAR PLACAR E FINALIZAR PARTIDA (Admin) - NOVA FUNCIONALIDADE
router.post('/admin/finish/:id', protect, admin, async (req, res) => {
  try {
    const matchId = req.params.id;
    const { scoreA, scoreB } = req.body;

    console.log('👑 ADMIN - Finalizando partida:', matchId, { scoreA, scoreB });

    // Validar placar
    if (scoreA === undefined || scoreB === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Placar é obrigatório (scoreA e scoreB)'
      });
    }

    if (scoreA < 0 || scoreB < 0) {
      return res.status(400).json({
        success: false,
        message: 'Placar não pode ser negativo'
      });
    }

    // Buscar partida
    let match;
    if (/^\d+$/.test(matchId)) {
      match = await Match.findOne({ matchId: parseInt(matchId) });
    } else {
      match = await Match.findById(matchId);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Partida não encontrada'
      });
    }

    // Verificar se a partida já está finalizada
    if (match.status === 'finished') {
      return res.status(400).json({
        success: false,
        message: 'Esta partida já está finalizada'
      });
    }

    // Determinar vencedor
    let winner;
    if (scoreA > scoreB) {
      winner = 'teamA';
    } else if (scoreB > scoreA) {
      winner = 'teamB';
    } else {
      winner = 'draw';
    }

    console.log(`🎯 Resultado: ${scoreA}-${scoreB}, Vencedor: ${winner}`);

    // Atualizar partida
    const updatedMatch = await Match.findByIdAndUpdate(
      match._id,
      {
        scoreA: parseInt(scoreA),
        scoreB: parseInt(scoreB),
        status: 'finished',
        isFinished: true,
        winner: winner
      },
      { new: true, runValidators: true }
    );

    console.log('✅ Partida finalizada:', `${updatedMatch.teamA} vs ${updatedMatch.teamB}`);

    // 🔥 PROCESSAR PONTOS AUTOMATICAMENTE PARA TODOS OS PALPITES
    console.log('🔄 Processando pontos para partida finalizada...');
    const affectedBets = await processMatchResults(updatedMatch.matchId);
    
    console.log(`✅ Pontos processados para ${affectedBets} palpites`);

    res.json({
      success: true,
      message: 'Partida finalizada com sucesso e pontos calculados!',
      data: updatedMatch,
      stats: {
        affectedBets: affectedBets,
        result: `${scoreA}-${scoreB}`,
        winner: winner === 'teamA' ? updatedMatch.teamA : winner === 'teamB' ? updatedMatch.teamB : 'Empate'
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO FINALIZAR PARTIDA:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao finalizar partida'
    });
  }
});

// 🔥 RECALCULAR PONTOS PARA UMA PARTIDA ESPECÍFICA (Admin) - NOVA FUNCIONALIDADE
router.post('/admin/recalculate-points/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId);

    console.log('👑 ADMIN - Recalculando pontos para partida:', matchId);

    // Verificar se a partida existe e está finalizada
    const match = await Match.findOne({ matchId, status: 'finished' });
    
    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Partida não encontrada ou não está finalizada'
      });
    }

    // Processar pontos
    const affectedBets = await processMatchResults(matchId);

    res.json({
      success: true,
      message: `Pontos recalculados para partida ${matchId}`,
      stats: {
        match: `${match.teamA} vs ${match.teamB}`,
        result: `${match.scoreA}-${match.scoreB}`,
        affectedBets: affectedBets,
        winner: match.winner === 'teamA' ? match.teamA : match.winner === 'teamB' ? match.teamB : 'Empate'
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO RECALCULAR PONTOS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao recalcular pontos'
    });
  }
});

// 🔥 DEFINIR PÓDIO FINAL E CALCULAR PONTOS (Admin) - NOVA FUNCIONALIDADE
router.post('/admin/set-podium', protect, admin, async (req, res) => {
  try {
    const { first, second, third } = req.body;

    console.log('👑 ADMIN - Definindo pódio final:', { first, second, third });

    // Validar campos
    if (!first || !second || !third) {
      return res.status(400).json({
        success: false,
        message: 'Todos os campos do pódio são obrigatórios: first, second, third'
      });
    }

    // Verificar se os times são diferentes
    const podiumTeams = [first, second, third];
    const uniqueTeams = [...new Set(podiumTeams)];
    
    if (uniqueTeams.length !== 3) {
      return res.status(400).json({
        success: false,
        message: 'Os times do pódio devem ser diferentes'
      });
    }

    // Buscar todas as partidas finalizadas para calcular pontos
    const finishedMatches = await Match.find({ status: 'finished' });
    
    if (finishedMatches.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Não há partidas finalizadas para calcular pontos'
      });
    }

    const actualPodium = { first, second, third };

    // Recalcular todos os pontos incluindo o pódio
    const updatedCount = await Bet.recalculateAllPoints(finishedMatches, actualPodium);
    
    // Atualizar ranking
    const rankedCount = await Bet.updateRanking();

    console.log(`✅ Pódio definido e pontos calculados para ${updatedCount} participantes`);

    res.json({
      success: true,
      message: 'Pódio definido com sucesso e pontos calculados!',
      data: {
        podium: actualPodium,
        stats: {
          participants: updatedCount,
          finishedMatches: finishedMatches.length,
          rankingUpdated: rankedCount
        }
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO DEFINIR PÓDIO:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao definir pódio'
    });
  }
});

// ======================
// 🎯 FUNÇÃO AUXILIAR: PROCESSAR PONTOS DE UMA PARTIDA
// ======================
async function processMatchResults(matchId) {
  try {
    console.log(`🎯 Processando pontos para partida ${matchId}...`);
    
    // Buscar partida finalizada
    const match = await Match.findOne({ matchId, status: 'finished' });
    
    if (!match) {
      throw new Error(`Partida ${matchId} não encontrada ou não está finalizada`);
    }

    // Buscar todos os palpites para esta partida
    const bets = await Bet.find({ 
      'groupMatches.matchId': matchId,
      hasSubmitted: true 
    }).populate('user', 'name');

    console.log(`🔍 Encontrados ${bets.length} palpites para a partida ${matchId}`);

    let processedCount = 0;

    // Calcular pontos para cada usuário
    for (const bet of bets) {
      try {
        // Recalcular pontos para este palpite
        await bet.calculatePoints([match]);
        processedCount++;
        
        console.log(`✅ Pontos calculados para ${bet.user.name}`);
      } catch (betError) {
        console.error(`❌ Erro ao calcular pontos para ${bet.user.name}:`, betError);
      }
    }

    // Atualizar ranking geral após processar todos os palpites
    if (processedCount > 0) {
      await Bet.updateRanking();
      console.log(`🏆 Ranking atualizado para ${processedCount} participantes`);
    }

    console.log(`✅ Processamento concluído: ${processedCount}/${bets.length} palpites processados`);
    
    return processedCount;

  } catch (error) {
    console.error('❌ ERRO NO PROCESSAMENTO DE PONTOS:', error);
    throw error;
  }
}

// ======================
// 🌐 ROTA DE STATUS/TESTE
// ======================
router.get('/test/hello', (req, res) => {
  res.json({ 
    success: true,
    message: 'Rotas de jogos estão funcionando!',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET    /api/matches',
      'GET    /api/matches/:id',
      'GET    /api/matches/stats/summary',
      'GET    /api/matches/upcoming/next',
      'GET    /api/matches/group/:groupName',
      'POST   /api/matches/initialize',
      'DELETE /api/matches/reset',
      'POST   /api/matches/admin/add',
      'PUT    /api/matches/admin/edit/:id',
      'DELETE /api/matches/admin/delete/:id',
      'GET    /api/matches/admin/all',
      'POST   /api/matches/admin/finish/:id',
      'POST   /api/matches/admin/recalculate-points/:matchId',
      'POST   /api/matches/admin/set-podium',
      'GET    /api/matches/test/hello'
    ]
  });
});

module.exports = router;
