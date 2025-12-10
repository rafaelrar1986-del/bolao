const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

// GET global settings
router.get('/', protect, async (req, res) => {
  const doc = await Settings.getSingleton();
  res.json({ success: true, settings: doc });
});

// UPDATE global settings (admin only)
router.post('/', protect, admin, async (req, res) => {
  const { blockSaveBets, blockSaveKnockout, requireAllGroupBets } = req.body || {};
  const doc = await Settings.getSingleton();

  if (typeof blockSaveBets === 'boolean') doc.blockSaveBets = blockSaveBets;
  if (typeof blockSaveKnockout === 'boolean') doc.blockSaveKnockout = blockSaveKnockout;
  if (typeof requireAllGroupBets === 'boolean') doc.requireAllGroupBets = requireAllGroupBets;

  await doc.save();
  res.json({ success: true, settings: doc });
});

module.exports = router;
