const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/auth');
const { getBetLockState } = require('../services/betLockService');
const {
  getVisibilityLockState,
  getGlobalPredictionVisibilityState,
  maskPodium
} = require('../services/betVisibilityService');

const router = express.Router();

function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'O parâmetro leagueId é obrigatório' });
    }

    const isRequestingOwnProfile = req.user._id.toString() === userId.toString();
    const isAdmin = req.user.isAdmin === true;

    const configId = toLeagueId(leagueId);
    
    // 1. Busca os dados (Matches filtradas por liga)
    // 🆕 CORREÇÃO: leagueId é String em todos os schemas
    const [settings, matches, bet] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: toLeagueId(leagueId) }).lean(),
      Bet.findOne({ 
        user: userId, 
        leagueId: toLeagueId(leagueId)
      }).lean()
    ]);

    if (!bet) {
      return res.status(404).json({ success: false, message: 'Palpites não encontrados' });
    }

    // Se for o dono ou admin, libera tudo imediatamente
    if (isRequestingOwnProfile) {
      return res.json({
        success: true,
        data: {
          groupMatches: bet.groupMatches || [],
          podium: bet.podium || null,
          hasSubmitted: bet.hasSubmitted
        }
      });
    }

    // A visibilidade é derivada da possibilidade real de edição da aposta,
    // nunca diretamente de unlockedPhases.
    const maskedGroupMatches = (bet.groupMatches || []).map(g => {
      const m = matches.find(x => Number(x.matchId) === Number(g.matchId));
      const isOwner = false; // este bloco é sempre sobre o adversário
      const visibilityState = getVisibilityLockState(
        m,
        settings,
        isAdmin,
        getBetLockState,
        isOwner
      );
      const locked = visibilityState.locked;

      return {
        matchId: g.matchId,
        winner: locked ? '🔒' : g.winner,
        scoreA: locked ? null : g.scoreA,
        scoreB: locked ? null : g.scoreB,
        qualifier: locked ? (g.qualifier ? '🔒' : null) : g.qualifier,
        isLocked: locked
      };
    });

    const globalVisibility = getGlobalPredictionVisibilityState(
      settings,
      isAdmin,
      false
    );

    const finalPodium = maskPodium(
      bet.podium,
      globalVisibility.locked
    );

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
