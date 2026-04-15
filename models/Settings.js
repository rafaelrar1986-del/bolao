const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    /**
     * 🆔 ID DA CONFIGURAÇÃO
     * Para manter o frontend sem alterações, usaremos um ID fixo como 'global_settings'
     * quando for salvar cron_interval e api_leagues. 
     * Para pódios e bloqueios por liga, usaremos 'league_ID'.
     */
    _id: {
      type: String,
      required: true
    },

    // 🤖 CONFIGURAÇÕES DO ATUALIZADOR AUTOMÁTICO (Global ou por Liga)
    cron_interval: {
      type: Number,
      default: 5,
      min: 1
    },
    api_leagues: {
      type: [Number],
      default: [4, 6, 32, 33] 
    },
    api_season: {
      type: Number,
      default: 2026
    },
    last_api_run: {
      type: Number,
      default: 0
    },

    // 🔒 BLOQUEIOS DE EDIÇÃO
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

    // 🔐 CONTROLE DE VISIBILIDADE
    unlockedPhases: {
      type: [String], 
      default: ['group']
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
    },

    // 🏆 CAMPO DE PÓDIO
    podium: {
      first: { type: String, default: null },
      second: { type: String, default: null },
      third: { type: String, default: null },
      fourth: { type: String, default: null }
    },
    
    // Campos legados mantidos apenas para compatibilidade de leitura
    key: {
      type: String,
      default: 'league_settings'
    },
    leagueId: {
      type: Number
    }
  },
  {
    timestamps: true,
    // CRITICAL: Desativa a criação de índices automáticos para matar o erro 11000
    autoIndex: false 
  }
);

const Settings = mongoose.model('Settings', SettingsSchema);

/**
 * 🧹 SCRIPT DE LIMPEZA AUTO-EXECUTÁVEL
 * Tenta dropar os índices problemáticos assim que o modelo é carregado.
 */
const dropLegacyIndexes = async () => {
  try {
    const indexes = await Settings.collection.listIndexes().toArray();
    const hasKeyIndex = indexes.some(idx => idx.name === 'key_1');
    const hasCompoundIndex = indexes.some(idx => idx.name === 'key_1_leagueId_1');

    if (hasKeyIndex) await Settings.collection.dropIndex('key_1');
    if (hasCompoundIndex) await Settings.collection.dropIndex('key_1_leagueId_1');
    
    console.log("✅ [Database] Verificação de índices legados concluída.");
  } catch (err) {
    // Silencioso: se os índices não existirem, o erro é ignorado
  }
};

dropLegacyIndexes();

module.exports = Settings;
