// routes/settings.js
const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

// GET global settings (public)
router.get('/global', async (req, res) => {
  try {
    let s = await Settings.findById('global_settings').lean();
    if (!s) {
      s = await Settings.create({ _id: 'global_settings' });
    }
    res.json({ success: true, data: s });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erro ao ler configurações' });
  }
});

// POST update settings (admin only)
router.post('/global', protect, admin, async (req, res) => {
  try {
    const updates = {};
    ['blockSaveBets','blockSaveKnockout','requireAllBets'].forEach(k => {
      if (req.body[k] !== undefined) updates[k] = !!req.body[k];
    });
    const s = await Settings.findByIdAndUpdate('global_settings', { $set: updates }, { new: true, upsert: true }).lean();
    res.json({ success: true, data: s });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações' });
  }
});

module.exports = router;
