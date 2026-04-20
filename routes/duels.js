const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/auth');

const router = express.Router();

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

    const configId = getConfigId(leagueId);
    
    // 1. Busca os dados (Matches filtradas por liga)
    const [settings, matches, bet] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: Number(leagueId) }).lean(),
      Bet.findOne({ user: userId, leagueId: String(leagueId) }).lean()
    ]);

    if (!bet) {
      return res.status(404).json({ success: false, message: 'Palpites não encontrados' });
    }

    // Se for o dono ou admin, libera tudo
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

    // 2. Mapeamento com checagem rigorosa
    const maskedGroupMatches = (bet.groupMatches || []).map(g => {
      // Garantimos que a comparação de ID seja numérica
      const m = matches.find(x => Number(x.matchId) === Number(g.matchId));
      
      let isLocked = true; // Começa bloqueado por segurança

      if (m) {
        if (m.phase === 'group') {
          // Bloqueia se 'group' NÃO estiver no array
          isLocked = !unlockedPhases.includes('group');
        } else {
          // Bloqueia se a fase (m.group) NÃO estiver no array
          // m.group aqui costuma ser 'oitavas', 'quartas', etc.
          isLocked = !unlockedPhases.includes(m.group);
        }
      }

      // Se estiver bloqueado, SOBRESCREVEMOS o valor. Não há como o front ler o original.
      return {
        matchId: g.matchId,
        winner: isLocked ? '🔒' : g.winner,
        qualifier: isLocked ? (g.qualifier ? '🔒' : null) : g.qualifier,
        isLocked: isLocked
      };
    });

    // 3. Trava do Pódio
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
    console.error('Erro crítico no duelo:', e);
    res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

module.exports = router;
