// models/Settings.js
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'global_settings' },
  blockSaveBets: { type: Boolean, default: false },
  blockSaveKnockout: { type: Boolean, default: false },
  requireAllBets: { type: Boolean, default: false },
}, { _id: false, timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);
