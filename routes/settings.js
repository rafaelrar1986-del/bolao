const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

/**
 * @route   GET /api/settings/global
 * @desc    Busca as configurações globais (necessário sufixo /global para compatibilidade com o front antigo)
 */
router.get('/global', async (req, res) => {
  try {
    let settings = await Settings.findById('global_settings');
    
    // Se não existir, cria o documento inicial com os padrões do model
    if (!settings) {
      settings = await Settings.create({ _id: 'global_settings' });
    }
    
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @route   POST /api/settings/admin/update
 * @desc    Atualiza campos das configurações (Protegido para Admin)
 */
router.post('/admin/update', protect, admin, async (req, res) => {
  try {
    const updates = req.body;

    // Usamos o $set para atualizar apenas os campos enviados no body
    // Isso garante que você possa atualizar o robô sem mexer nas travas de visibilidade e vice-versa
    const settings = await Settings.findByIdAndUpdate(
      'global_settings',
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ 
      success: true, 
      message: 'Configurações atualizadas com sucesso', 
      data: settings 
    });
  } catch (err) {
    console.error('Erro ao atualizar settings:', err);
    res.status(500).json({ success: false, message: 'Erro ao salvar configurações' });
  }
});

module.exports = router;
