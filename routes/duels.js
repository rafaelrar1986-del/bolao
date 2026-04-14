// routes/duels.js
const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/duels/:userId
 * @desc    Busca palpites de um usuário específico para comparação, respeitando as travas de fase e liga
 * @access  Protegido
 */
router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { leagueId } = req.query; // 👈 Recebe a liga para filtrar o duelo corretamente

    if (!leagueId) {
      return res.status(400).json({ 
        success: false, 
        message: 'O parâmetro leagueId é obrigatório' 
      });
    }

    const isRequestingOwnProfile = req.user._id.toString() === userId;
    const isAdmin = req.user.isAdmin === true;

    // 1. Busca configurações, partidas e palpites filtrados pela LIGA
    const [settings, matches, bet] = await Promise.all([
      Settings.findOne({ leagueId: leagueId }).lean(), // 👈 Configurações da liga específica
      Match.find({ leagueId: leagueId }, 'matchId phase group').lean(), 
      Bet.findOne({ user: userId, leagueId: leagueId })
        .select('groupMatches podium hasSubmitted')
        .lean()
    ]);

    if (!bet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Palpites não encontrados para este usuário nesta liga' 
      });
    }

    // Se for o próprio usuário ou admin, retorna tudo sem filtros de visibilidade
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

    // 2. Lógica de Bloqueio (Filtro para comparação entre outros usuários)
    const unlockedPhases = settings?.unlockedPhases || [];
    
    // Mapeia os dados das partidas para consulta rápida de fase/grupo
    const matchDataMap = {};
    matches.forEach(m => {
      matchDataMap[m.matchId] = {
        phase: m.phase,
        group: m.group
      };
    });

    // Filtra os palpites: oculta o que ainda não foi liberado pelo administrador
    const maskedGroupMatches = (bet.groupMatches || []).map(m => {
      const matchInfo = matchDataMap[m.matchId];
      
      // Se não encontrar dados da partida, bloqueia por segurança
      if (!matchInfo) {
        return { 
          matchId: m.matchId, 
          winner: '🔒', 
          qualifier: m.qualifier ? '🔒' : null, 
          isLocked: true 
        };
      }

      let isUnlocked = false;

      // Verificação de visibilidade dinâmica
      if (matchInfo.phase === 'group') {
        // Se a fase de grupos estiver desbloqueada
        isUnlocked = unlockedPhases.includes('group');
      } else {
        // Se a sub-fase do mata-mata (ex: 'oitavas', 'quartas') estiver desbloqueada
        isUnlocked = unlockedPhases.includes(matchInfo.group);
      }

      if (isUnlocked) return m;

      // Se bloqueado, retorna o ID mas mascara os valores
      return {
        matchId: m.matchId,
        winner: '🔒', 
        qualifier: m.qualifier ? '🔒' : null,
        isLocked: true
      };
    });

    // Lógica para o Pódio: liberado se 'podium' ou 'final' estiver no array de desbloqueio
    const podiumLocked = !unlockedPhases.includes('podium') && !unlockedPhases.includes('final');
    const maskedPodium = podiumLocked ? null : bet.podium;

    res.json({
      success: true,
      data: {
        groupMatches: maskedGroupMatches,
        podium: maskedPodium,
        hasSubmitted: bet.hasSubmitted,
        isFiltered: true // Indica ao front-end que os dados estão mascarados por privacidade
      }
    });

  } catch (e) {
    console.error('Erro na rota de duelo:', e);
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao carregar dados do duelo' 
    });
  }
});

module.exports = router;
