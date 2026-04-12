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
 * ✅ ROTA ADICIONAL: POST /api/settings/robot
 * Mantém a compatibilidade e adiciona a função do robô sem mexer no /global
 */
router.post('/robot', protect, admin, async (req, res) => {
  try {
    const { robotApiKey, robotEnabled, robotSyncInterval } = req.body;
    
    const s = await Settings.findByIdAndUpdate(
      'global_settings',
      { 
        $set: { 
          robotApiKey, 
          robotEnabled: !!robotEnabled, 
          robotSyncInterval: parseInt(robotSyncInterval) || 30 
        } 
      },
      { new: true, upsert: true }
    ).lean();

    res.json({ success: true, message: 'Configurações do Robô atualizadas!', data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar robô' });
  }
});

module.exports = router;
