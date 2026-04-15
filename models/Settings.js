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
      default: [4, 6, 32, 33] 
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

    // 🏆 [ADICIONADO] CAMPO DE PÓDIO
    // Necessário para que o pointsService funcione corretamente
    podium: {
      first: { type: String, default: null },
      second: { type: String, default: null },
      third: { type: String, default: null },
      fourth: { type: String, default: null }
    },
    
    // Campo auxiliar para buscas se necessário (sem índice único)
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
    // Bloqueia a criação automática de índices para evitar o erro 11000
    autoIndex: false 
  }
);

// Criamos o modelo
const Settings = mongoose.model('Settings', SettingsSchema);

/**
 * 🧹 LIMPEZA DE EMERGÊNCIA
 * Tenta remover os índices que estavam travando o banco de dados.
 * Isso roda apenas uma vez quando o servidor sobe.
 */
Settings.collection.dropIndex('key_1').catch(() => {
  // Ignora erro se o índice não existir
});
Settings.collection.dropIndex('key_1_leagueId_1').catch(() => {
  // Ignora erro se o índice não existir
});

module.exports = Settings;
