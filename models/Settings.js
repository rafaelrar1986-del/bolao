// models/Settings.js
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    // ⚠️ mantém o mesmo ID global
    _id: {
      type: String,
      default: 'global_settings'
    },

    // 🔒 BLOQUEIOS EXISTENTES (mantidos)
    blockSaveBets: {
      type: Boolean,
      default: false
    },

    blockSaveKnockout: {
      type: Boolean,
      default: false
    },

    requireAllBets: {
      type: Boolean,
      default: false
    },

    // 🔐 NOVOS CAMPOS (NÃO QUEBRAM)
    statsLocked: {
      type: Boolean,
      default: false
    },

    lockedReason: {
      type: String,
      default: null
    },

    unlockAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Settings', SettingsSchema);
