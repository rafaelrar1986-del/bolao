// models/Settings.js
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    /**
     * 🆔 ID DA CONFIGURAÇÃO
     * Em vez de 'global_settings', usaremos o ID da liga (ex: 'league_27', 'league_1')
     * Isso permite que cada campeonato tenha regras de bloqueio independentes.
     */
    _id: {
      type: String,
      required: true
    },

    // 🤖 CONFIGURAÇÕES DO ATUALIZADOR AUTOMÁTICO (ROBÔ POR LIGA)
    cron_interval: {
      type: Number,
      default: 5, // Intervalo em minutos
      min: 1
    },
    api_leagues: {
      type: [Number],
      default: [4, 6, 32, 33] // IDs das ligas na API externa correspondentes a esta liga do bolão
    },
    api_season: {
      type: Number,
      default: 2026
    },
    last_api_run: {
      type: Number, // Armazena o timestamp (Date.now())
      default: 0
    },

    // 🔒 BLOQUEIOS DE EDIÇÃO POR LIGA
    // Permite fechar as apostas de uma liga sem afetar as outras
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

    // 🔐 CONTROLE DE VISIBILIDADE (O que os usuários podem ver uns dos outros nesta liga)
    unlockedPhases: {
      type: [String], 
      default: ['group'] // 'group', 'round_16', 'quarter', 'semi', 'final'
    },

    // 📊 ESTATÍSTICAS E RANKING
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
    // Adiciona createdAt e updatedAt automaticamente
    timestamps: true
  }
);

module.exports = mongoose.model('Settings', SettingsSchema);
