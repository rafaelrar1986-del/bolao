const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

/**
 * @route   GET /api/settings/global
 * @desc    Busca as configurações de uma liga específica
 * @access  Público
 */
router.get('/global', async (req, res) => {
  try {
    // Agora buscamos pelo leagueId enviado via query (ex: ?leagueId=27)
    const leagueId = req.query.leagueId || '1';
    const configId = `league_${leagueId}`;

    let s = await Settings.findById(configId).lean();
    
    if (!s) {
      // Se não existir, cria a configuração inicial para essa liga
      s = await Settings.create({ _id: configId });
    }
    
    res.json({ success: true, data: s });
  } catch (err) {
    console.error('Erro ao ler configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao ler configurações' });
  }
});

/**
 * @route   POST /api/settings/global
 * @desc    Atualiza as configurações (Trava de edição, Visibilidade de Fases e Stats)
 * @access  Privado (Admin)
 */
router.post('/global', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const configId = `league_${leagueId}`;
    const updates = {};

    const booleanFields = [
      'blockSaveBets', 
      'blockSaveKnockout', 
      'requireAllBets', 
      'statsLocked'
    ];
    
    booleanFields.forEach(k => {
      if (req.body[k] !== undefined) {
        updates[k] = !!req.body[k];
      }
    });

    if (req.body.unlockedPhases && Array.isArray(req.body.unlockedPhases)) {
      updates.unlockedPhases = req.body.unlockedPhases;
    }

    if (req.body.lockedReason !== undefined) {
      updates.lockedReason = req.body.lockedReason;
    }

    if (req.body.unlockAt !== undefined) {
      updates.unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
    }

    const s = await Settings.findByIdAndUpdate(
      configId, 
      { $set: updates }, 
      { new: true, upsert: true }
    ).lean();

    res.json({ 
      success: true, 
      message: `Configurações da liga ${leagueId} atualizadas!`,
      data: s 
    });

  } catch (err) {
    console.error('Erro ao atualizar configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações' });
  }
});

/**
 * ✅ ROTA: POST /api/settings/admin/update
 * Processa dados do Robô e bloqueios para uma liga específica.
 */
router.post('/admin/update', protect, admin, async (req, res) => {
  try {
    const { 
      leagueId,
      cron_interval, 
      api_season, 
      api_leagues,
      blockSaveBets,
      blockSaveKnockout,
      requireAllBets,
      statsLocked 
    } = req.body;

    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    const configId = `league_${leagueId}`;

    const updates = {};

    // 🤖 Configurações do Robô
    if (cron_interval !== undefined) updates.cron_interval = Number(cron_interval);
    if (api_season !== undefined) updates.api_season = Number(api_season);
    if (api_leagues !== undefined) {
      updates.api_leagues = Array.isArray(api_leagues) 
        ? api_leagues.map(id => Number(id)) 
        : [];
    }

    // 🔒 Sincroniza também os booleanos
    if (blockSaveBets !== undefined) updates.blockSaveBets = !!blockSaveBets;
    if (blockSaveKnockout !== undefined) updates.blockSaveKnockout = !!blockSaveKnockout;
    if (requireAllBets !== undefined) updates.requireAllBets = !!requireAllBets;
    if (statsLocked !== undefined) updates.statsLocked = !!statsLocked;

    const s = await Settings.findByIdAndUpdate(
      configId,
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.json({ 
      success: true, 
      message: `Configurações da liga ${leagueId} salvas com sucesso!`, 
      data: s 
    });
  } catch (err) {
    console.error('Erro na rota /admin/update:', err);
    res.status(500).json({ success: false, message: 'Erro ao salvar configurações' });
  }
});

/**
 * ✅ ROTA: POST /api/settings/robot
 * Atualiza especificamente os dados da API para uma liga.
 */
router.post('/robot', protect, admin, async (req, res) => {
  try {
    const { leagueId, cron_interval, api_season, api_leagues } = req.body;
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const configId = `league_${leagueId}`;
    
    const s = await Settings.findByIdAndUpdate(
      configId,
      { 
        $set: { 
          cron_interval: Number(cron_interval) || 5,
          api_season: Number(api_season) || 2026,
          api_leagues: Array.isArray(api_leagues) ? api_leagues : []
        } 
      },
      { new: true, upsert: true }
    ).lean();

    res.json({ success: true, message: `Robô da liga ${leagueId} atualizado!`, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar robô' });
  }
});

module.exports = router;
