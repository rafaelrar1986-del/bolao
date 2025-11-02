const express = require('express');
const Match = require('../models/Match');
const router = express.Router();

// 📋 LISTAR TODOS OS JOGOS
router.get('/', async (req, res) => {
  try {
    const matches = await Match.find().sort({ date: 1, time: 1 });
    
    res.json({
      success: true,
      count: matches.length,
      data: matches
    });
  } catch (error) {
    console.error('Erro ao buscar jogos:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao carregar lista de jogos' 
    });
  }
});

// 🔍 BUSCAR JOGO POR ID
router.get('/:id', async (req, res) => {
  try {
    const match = await Match.findOne({ matchId: req.params.id });
    
    if (!match) {
      return res.status(404).json({ 
        success: false,
        message: 'Jogo não encontrado' 
      });
    }

    res.json({
      success: true,
      data: match
    });
  } catch (error) {
    console.error('Erro ao buscar jogo:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao buscar jogo' 
    });
  }
});

// 🎯 INICIALIZAR JOGOS (APENAS PARA DESENVOLVIMENTO)
router.post('/initialize', async (req, res) => {
  try {
    const initialMatches = [
      // Grupo A
      { matchId: 1, teamA: "Brasil", teamB: "Croácia", date: "13/06/2026", time: "16:00", group: "Grupo A" },
      { matchId: 2, teamA: "Alemanha", teamB: "Japão", date: "14/06/2026", time: "13:00", group: "Grupo A" },
      { matchId: 3, teamA: "Brasil", teamB: "Alemanha", date: "19/06/2026", time: "16:00", group: "Grupo A" },
      { matchId: 4, teamA: "Croácia", teamB: "Japão", date: "20/06/2026", time: "13:00", group: "Grupo A" },
      
      // Grupo B
      { matchId: 5, teamA: "Argentina", teamB: "Holanda", date: "14/06/2026", time: "16:00", group: "Grupo B" },
      { matchId: 6, teamA: "França", teamB: "Estados Unidos", date: "15/06/2026", time: "13:00", group: "Grupo B" },
      { matchId: 7, teamA: "Argentina", teamB: "França", date: "19/06/2026", time: "19:00", group: "Grupo B" },
      { matchId: 8, teamA: "Holanda", teamB: "Estados Unidos", date: "20/06/2026", time: "16:00", group: "Grupo B" },
    ];

    // Limpar jogos existentes e inserir novos
    await Match.deleteMany({});
    await Match.insertMany(initialMatches);

    res.json({ 
      success: true,
      message: `${initialMatches.length} jogos inicializados com sucesso!`,
      data: initialMatches
    });

  } catch (error) {
    console.error('Erro ao inicializar jogos:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erro ao inicializar jogos' 
    });
  }
});

// 🌐 ROTA DE TESTE
router.get('/test/hello', (req, res) => {
  res.json({ 
    message: 'Rotas de jogos estão funcionando!',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;