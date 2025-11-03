const express = require('express');
const Bet = require('../models/Bet');
const { protect } = require('../middleware/auth');
const router = express.Router();

// 🌐 ROTA RAIZ - ADICIONE ESTA ROTA (NOVA)
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites do Bolão da Copa 2026!',
    endpoints: {
      'GET /my-bets': 'Buscar meus palpites (protegido)',
      'POST /save': 'Salvar palpites (protegido)',
      'GET /status': 'Verificar status (protegido)',
      'GET /test': 'Rota de teste (protegido)'
    },
    instructions: 'Use as rotas específicas acima para interagir com a API',
    timestamp: new Date().toISOString()
  });
});

// 🎯 BUSCAR PALPITES DO USUÁRIO
router.get('/my-bets', protect, async (req, res) => {
  try {
    console.log('🎯 Buscando palpites do usuário:', req.user._id);
    
    let userBet = await Bet.findOne({ user: req.user._id })
      .populate('user', 'name email');

    if (!userBet) {
      userBet = await Bet.create({ 
        user: req.user._id,
        groupMatches: [],
        podium: { first: null, second: null, third: null },
        totalPoints: 0,
        hasSubmitted: false
      });
    }

    res.json({
      success: true,
      data: userBet
    });

  } catch (error) {
    console.error('❌ ERRO AO BUSCAR PALPITES:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar palpites'
    });
  }
});

// 💾 SALVAR PALPITES (APENAS UMA VEZ)
router.post('/save', protect, async (req, res) => {
  try {
    console.log('💾 Tentando salvar palpites para:', req.user.name);
    
    const { groupMatches, podium } = req.body;
    const userId = req.user._id;

    // 🔥 VERIFICAR SE JÁ ENVIOU PALPITES
    let userBet = await Bet.findOne({ user: userId });
    
    if (userBet && userBet.hasSubmitted) {
      return res.status(400).json({
        success: false,
        message: 'Você já enviou seus palpites! Não é possível alterá-los.',
        firstSubmission: userBet.firstSubmission
      });
    }

    // Criar ou atualizar registro
    if (!userBet) {
      userBet = new Bet({ 
        user: userId,
        firstSubmission: new Date(),
        hasSubmitted: true
      });
    } else {
      userBet.firstSubmission = new Date();
      userBet.hasSubmitted = true;
    }

    // Atualizar palpites dos jogos
    if (groupMatches) {
      userBet.groupMatches = Object.entries(groupMatches).map(([matchId, bet]) => ({
        matchId: parseInt(matchId),
        bet: bet
      }));
    }

    // Atualizar pódio
    if (podium) {
      userBet.podium = podium;
    }

    await userBet.save();

    console.log('✅ Palpites salvos com sucesso! (Primeira submissão)');

    res.json({
      success: true,
      message: 'Palpites enviados com sucesso! Não será possível alterá-los.',
      data: userBet,
      firstSubmission: true
    });

  } catch (error) {
    console.error('❌ ERRO AO SALVAR PALPITES:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao salvar palpites'
    });
  }
});

// 🔍 VERIFICAR STATUS DOS PALPITES
router.get('/status', protect, async (req, res) => {
  try {
    const userBet = await Bet.findOne({ user: req.user._id });
    
    const status = {
      hasSubmitted: userBet ? userBet.hasSubmitted : false,
      firstSubmission: userBet ? userBet.firstSubmission : null,
      canEdit: !userBet || !userBet.hasSubmitted
    };

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('❌ ERRO AO VERIFICAR STATUS:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar status'
    });
  }
});

// 🌐 ROTA DE TESTE
router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Rotas de palpites funcionando!',
    user: req.user.name
  });
});

module.exports = router;
