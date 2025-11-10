// models/Setting.js
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    podium: {
      first: { type: String },
      second: { type: String },
      third: { type: String }
    },
    // flag global para abrir/fechar envios de apostas
    betsOpen: { type: Boolean, default: true }
  },
  { collection: 'settings', timestamps: true }
);

module.exports = mongoose.models.Setting || mongoose.model('Setting', SettingsSchema);
