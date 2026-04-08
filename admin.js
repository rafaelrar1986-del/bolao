// models/Settings.js
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    // ⚠️ Mantém o mesmo ID fixo para garantir que só exista um documento de config no banco
    _id: {
      type: String,
      default: 'global_settings'
    },

    // 🔒 BLOQUEIOS DE EDIÇÃO (Impedem o usuário de salvar/mudar palpites)
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

    // 🔐 CONTROLE DE VISIBILIDADE (O que os usuários podem ver uns dos outros)
    // Este é o campo chave para o seu novo sistema de travas por fase
    unlockedPhases: {
      type: [String], 
      default: ['group'] // Por padrão, libera a visualização da fase de grupos
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
