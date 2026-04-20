const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Helper idêntico ao que você deve ter no all-bets
const getConfigId = (leagueId) => `league_${leagueId}`;

router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'O parâmetro leagueId é obrigatório' });
    }

    const isRequestingOwnProfile = req.user._id.toString() === userId.toString();
    const isAdmin = req.user.isAdmin === true;

    // 1. Busca configurações, partidas e aposta (Igual ao all-bets)
    const configId = getConfigId(leagueId);
    const [settings, matches, bet] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: Number(leagueId) }).lean(),
      Bet.findOne({ user: userId, leagueId: String(leagueId) }).lean()
    ]);

    if (!bet) {
      return res.status(404).json({ success: false, message: 'Palpites não encontrados' });
    }

    // Se for o próprio usuário ou admin, não precisa de máscara
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

    const unlockedPhases = settings?.unlockedPhases || [];

    // 2. Mapeia os palpites com a lógica idêntica ao all-bets
    const maskedGroupMatches = (bet.groupMatches || []).map(g => {
      const m = matches.find(x => x.matchId === g.matchId);
      
      // LOGICA DO ALL-BETS REPLICADA:
      let isLocked = true; // Por padrão, bloqueado
      
      if (m?.phase === 'group') {
          // Se for grupo, checa se 'group' está desbloqueado
          isLocked = !unlockedPhases.includes('group');
      } else {
          // Se for mata-mata, checa se o nome da fase (armazenado em m.group) está desbloqueado
          // No seu sistema de mata-mata, m.group costuma guardar 'oitavas', 'quartas', etc.
          isLocked = !unlockedPhases.includes(m?.group);
      }

      // Se estiver bloqueado, envia o cadeado. Se não, envia o dado real.
      return {
        matchId: g.matchId,
        winner: isLocked ? '🔒' : g.winner,
        qualifier: isLocked ? (g.qualifier ? '🔒' : null) : g.qualifier,
        isLocked: isLocked
      };
    });

    // 3. Lógica do Pódio (Igual ao all-bets)
    const isPodiumLocked = !unlockedPhases.includes('podium');
    const finalPodium = (bet.podium && !isPodiumLocked) ? bet.podium : (bet.podium ? { 
        first: '🔒', second: '🔒', third: '🔒', fourth: '🔒' 
    } : null);

    res.json({
      success: true,
      data: {
        groupMatches: maskedGroupMatches,
        podium: finalPodium,
        hasSubmitted: bet.hasSubmitted,
        isFiltered: true
      }
    });

  } catch (e) {
    console.error('Erro na rota de duelo:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar dados do duelo' });
  }
});

module.exports = router;
