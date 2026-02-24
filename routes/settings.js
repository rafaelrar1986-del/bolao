// routes/settings.js
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
      // Se não existir, cria o documento inicial com os padrões do Model
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

    // 1. Processa campos Booleanos (Travas de salvamento e Stats)
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

    // 2. ✅ NOVO: Processa o Array de Fases Desbloqueadas (unlockedPhases)
    if (req.body.unlockedPhases && Array.isArray(req.body.unlockedPhases)) {
      updates.unlockedPhases = req.body.unlockedPhases;
    }

    // 3. Processa campos de texto e data (Motivo do bloqueio e Timer)
    if (req.body.lockedReason !== undefined) {
      updates.lockedReason = req.body.lockedReason;
    }

    if (req.body.unlockAt !== undefined) {
      // Se enviar string vazia ou null, limpa a data. Caso contrário, converte para Date.
      updates.unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
    }

    // 4. Salva no banco de dados
    const s = await Settings.findByIdAndUpdate(
      'global_settings', 
      { $set: updates }, 
      { 
        new: true,   // Retorna o documento atualizado
        upsert: true // Cria se não existir
      }
    ).lean();

    res.json({ 
      success: true, 
      message: 'Configurações atualizadas com sucesso',
      data: s 
    });

  } catch (err) {
    console.error('Erro ao atualizar configurações:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao atualizar configurações' 
    });
  }
});

module.exports = router;
