const express = require('express');
const Bet = require('../models/Bet');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/duels/:userId
 * @desc    Busca palpites de um usuário específico para comparação no perfil
 * @access  Protegido
 */
router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;

    // Busca apenas o necessário: os palpites (groupMatches) e o pódio
    const bet = await Bet.findOne({ user: userId })
      .select('groupMatches podium hasSubmitted')
      .lean();

    if (!bet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Palpites não encontrados para este usuário' 
      });
    }

    // Retorna os dados mapeados conforme a estrutura do seu MongoDB (matchId e winner)
    res.json({
      success: true,
      data: {
        groupMatches: bet.groupMatches || [],
        podium: bet.podium || null,
        hasSubmitted: bet.hasSubmitted
      }
    });
  } catch (e) {
    console.error('Erro na rota de duelo:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar dados do duelo' });
  }
});

module.exports = router;
