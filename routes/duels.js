// routes/duels.js
const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/duels/:userId
 * @desc    Busca palpites de um usuário específico respeitando travas de visibilidade por liga
 * @access  Protegido
 */
router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({ 
        success: false, 
        message: 'O parâmetro leagueId é obrigatório' 
      });
    }

    // 1. Identificação de permissão (Dono ou Admin vê tudo)
    const isRequestingOwnProfile = req.user._id.toString() === userId.toString();
    const isAdmin = req.user.isAdmin === true;

    // 🛠️ CONSTRUÇÃO DO ID DE SETTINGS (Padrão: league_27)
    const settingsId = `league_${leagueId}`;

    // 2. Busca simultânea de Configurações, Partidas e Apostas
    const [settings, matches, bet] = await Promise.all([
      Settings.findById(settingsId).lean(), 
      Match.find({ leagueId: Number(leagueId) }, 'matchId phase group').lean(), 
      Bet.findOne({ user: userId, leagueId: String(leagueId) })
        .select('groupMatches podium hasSubmitted')
        .lean()
    ]);

    if (!bet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Palpites não encontrados para este usuário nesta liga' 
      });
    }

    // Se for o próprio usuário ou admin, retorna os dados originais imediatamente
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

    // 3. Lógica de Mascaramento (Para visitantes/comparação)
    // Normalizamos as fases para minúsculas para evitar erro de "Oitavas" vs "oitavas"
    const unlockedPhases = (settings?.unlockedPhases || []).map(p => p.toLowerCase());
    
    const matchDataMap = {};
    matches.forEach(m => {
      matchDataMap[m.matchId] = {
        phase: m.phase,
        group: m.group ? m.group.toLowerCase() : ''
      };
    });

    const maskedGroupMatches = (bet.groupMatches || []).map(m => {
      const matchInfo = matchDataMap[m.matchId];
      
      if (!matchInfo) {
        return { matchId: m.matchId, winner: '🔒', qualifier: m.qualifier ? '🔒' : null, isLocked: true };
      }

      let isUnlocked = false;

      if (matchInfo.phase === 'group') {
        isUnlocked = unlockedPhases.includes('group');
      } else {
        // Verifica se o nome simplificado da fase (ex: 'oitavas') está contido em alguma string do array
        // Isso resolve o problema de ter "Oitavas de final" no settings e "oitavas" no match
        isUnlocked = unlockedPhases.some(p => p.includes(matchInfo.group));
      }

      if (isUnlocked) return m;

      return {
        matchId: m.matchId,
        winner: '🔒', 
        qualifier: m.qualifier ? '🔒' : null,
        isLocked: true
      };
    });

    // 4. Lógica do Pódio (Mascarado se não estiver liberado)
    const isPodiumUnlocked = unlockedPhases.includes('podium') || unlockedPhases.includes('final');
    
    // Retornamos um objeto com cadeados no pódio para o DuelRenderer identificar visualmente
    const maskedPodium = isPodiumUnlocked ? bet.podium : {
      first: '🔒', second: '🔒', third: '🔒', fourth: '🔒'
    };

    res.json({
      success: true,
      data: {
        groupMatches: maskedGroupMatches,
        podium: maskedPodium,
        hasSubmitted: bet.hasSubmitted,
        isFiltered: true
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
