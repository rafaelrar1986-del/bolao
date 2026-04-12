const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

/**
 * @route   GET /api/settings/global
 * @desc    Busca as configurações globais do sistema
 * @access  Público
 */
router.get('/global', async (req, res) => {
  try {
    let s = await Settings.findById('global_settings').lean();
    if (!s) {
      s = await Settings.create({ _id: 'global_settings' });
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
      'global_settings', 
      { $set: updates }, 
      { new: true, upsert: true }
    ).lean();

    res.json({ 
      success: true, 
      message: 'Configurações atualizadas com sucesso',
      data: s 
    });

  } catch (err) {
    console.error('Erro ao atualizar configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações' });
  }
});

/**
 * ✅ NOVA ROTA: POST /api/settings/admin/update
 * Esta é a rota que seu frontend chamou e deu erro 404.
 * Agora ela processa os dados do Robô e as 34 ligas.
 */
router.post('/admin/update', protect, admin, async (req, res) => {
  try {
    const { 
      cron_interval, 
      api_season, 
      api_leagues,
      blockSaveBets,
      blockSaveKnockout,
      requireAllBets,
      statsLocked 
    } = req.body;

    const updates = {};

    // 🤖 Configurações do Robô (Campos do seu Model)
    if (cron_interval !== undefined) updates.cron_interval = Number(cron_interval);
    if (api_season !== undefined) updates.api_season = Number(api_season);
    if (api_leagues !== undefined) {
      updates.api_leagues = Array.isArray(api_leagues) 
        ? api_leagues.map(id => Number(id)) 
        : [];
    }

    // 🔒 Sincroniza também os booleanos caso venham nesta chamada
    if (blockSaveBets !== undefined) updates.blockSaveBets = !!blockSaveBets;
    if (blockSaveKnockout !== undefined) updates.blockSaveKnockout = !!blockSaveKnockout;
    if (requireAllBets !== undefined) updates.requireAllBets = !!requireAllBets;
    if (statsLocked !== undefined) updates.statsLocked = !!statsLocked;

    const s = await Settings.findByIdAndUpdate(
      'global_settings',
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.json({ 
      success: true, 
      message: 'Configurações do Robô salvas com sucesso!', 
      data: s 
    });
  } catch (err) {
    console.error('Erro na rota /admin/update:', err);
    res.status(500).json({ success: false, message: 'Erro ao salvar configurações do robô' });
  }
});

/**
 * ✅ ROTA ADICIONAL: POST /api/settings/robot
 * Mantida para compatibilidade, mas agora usa os campos do novo Model
 */
router.post('/robot', protect, admin, async (req, res) => {
  try {
    const { cron_interval, api_season, api_leagues } = req.body;
    
    const s = await Settings.findByIdAndUpdate(
      'global_settings',
      { 
        $set: { 
          cron_interval: Number(cron_interval) || 5,
          api_season: Number(api_season) || 2026,
          api_leagues: Array.isArray(api_leagues) ? api_leagues : []
        } 
      },
      { new: true, upsert: true }
    ).lean();

    res.json({ success: true, message: 'Robô atualizado!', data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar robô' });
  }
});

module.exports = router;
