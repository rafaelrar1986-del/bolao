// routes/duels.js
const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/duels/:userId
 * @desc    Busca palpites de um usuário específico para comparação, respeitando as travas de fase
 * @access  Protegido
 */
router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const isRequestingOwnProfile = req.user._id.toString() === userId;
    const isAdmin = req.user.isAdmin === true;

    // 1. Busca configurações globais e dados das partidas em paralelo
    // CORREÇÃO: Adicionado 'group' no select do Match para identificar a sub-fase do mata-mata
    const [settings, matches, bet] = await Promise.all([
      Settings.findById('global_settings').lean(),
      Match.find({}, 'matchId phase group').lean(), 
      Bet.findOne({ user: userId }).select('groupMatches podium hasSubmitted').lean()
    ]);

    if (!bet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Palpites não encontrados para este usuário' 
      });
    }

    // Se for o próprio usuário ou admin, retorna tudo sem filtros
    if (isRequestingOwnProfile || isAdmin) {
      return res.json({
        success: true,
        data: {
          groupMatches: bet.groupMatches || [],
          podium: bet.podium || null,
          hasSubmitted: bet.hasSubmitted
        }
      });
    }

    // 2. Lógica de Bloqueio (Filtro para outros usuários)
    const unlockedPhases = settings?.unlockedPhases || [];
    
    // Mapeia os dados de cada partida para consulta rápida
    const matchDataMap = {};
    matches.forEach(m => {
      matchDataMap[m.matchId] = {
        phase: m.phase,
        group: m.group
      };
    });

    // Filtra os palpites: lógica inteligente para distinguir Fase de Grupos de Mata-Mata
    const maskedGroupMatches = (bet.groupMatches || []).map(m => {
      const matchInfo = matchDataMap[m.matchId];
      
      // Se não encontrar dados da partida, bloqueia por segurança
      if (!matchInfo) {
        return { matchId: m.matchId, winner: '🔒', qualifier: m.qualifier ? '🔒' : null, isLocked: true };
      }

      let isUnlocked = false;

      // Verificação de visibilidade baseada na estrutura do seu MongoDB
      if (matchInfo.phase === 'group') {
        // Para fase de grupos, a chave no array unlockedPhases é 'group'
        isUnlocked = unlockedPhases.includes('group');
      } else if (matchInfo.phase === 'knockout') {
        // Para mata-mata, a chave no array unlockedPhases é o valor do campo 'group' (ex: '16-avos final')
        isUnlocked = unlockedPhases.includes(matchInfo.group);
      }

      if (isUnlocked) return m;

      // Se bloqueado, retorna o ID da partida mas oculta os palpites
      return {
        matchId: m.matchId,
        winner: '🔒', 
        qualifier: m.qualifier ? '🔒' : null,
        isLocked: true
      };
    });

    // Lógica para o Pódio (Geralmente só libera quando o torneio acaba ou se a 'final' estiver liberada)
    const podiumLocked = !unlockedPhases.includes('final');
    const maskedPodium = podiumLocked ? null : bet.podium;

    res.json({
      success: true,
      data: {
        groupMatches: maskedGroupMatches,
        podium: maskedPodium,
        hasSubmitted: bet.hasSubmitted,
        isFiltered: true // Flag para o front saber que há conteúdo oculto
      }
    });

  } catch (e) {
    console.error('Erro na rota de duelo:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar dados do duelo' });
  }
});

module.exports = router;
