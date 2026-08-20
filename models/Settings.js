const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema(
  {
    /**
     * 🆔 ID DA CONFIGURAÇÃO
     * Usamos o ID da liga como _id (ex: 'league_27', 'league_1', 'default')
     * Isso permite que cada campeonato tenha regras independentes.
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

    // 🔐 CONTROLE DE VISIBILIDADE (GERENCIADOR)
    // Define quais grades aparecem na tela para o usuário
    unlockedPhases: {
      type: [String],
      default: ['group']
    },

    /**
     * 🛡️ GRADE DE BLOQUEIO AUTOMÁTICO (ROBÔ)
     * Armazena as grades (ex: "16 avos de Final") que o robô trancou
     * assim que a primeira partida da fase começou.
     */
    lockedPhases: {
      type: [String],
      default: []
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

    // 🏆 REGRAS DE PONTUAÇÃO DO CAMPEONATO
    // Alinhado com pointsService.js e bets.js
    scoringRules: {
      // 'independent': cada categoria pontua de forma independente.
      // 'dependent': acerto do placar exato bloqueia gols A/B e vencedor;
      // apenas o placar exato e o classificado podem pontuar.
      scoringMode:   { type: String, enum: ['independent', 'dependent'], default: 'independent' },
      exactScore:    { type: Number, default: 5 },
      scoreTeamA:    { type: Number, default: 1 },
      scoreTeamB:    { type: Number, default: 1 },
      winner:        { type: Number, default: 2 },
      qualifier:     { type: Number, default: 3 },
      topScorer:     { type: Number, default: 10 },
      bestAttack:    { type: Number, default: 10 },
      worstDefense:  { type: Number, default: 10 },
      upset:         { type: Number, default: 15 },
      podiumPoints:  { type: [Number], default: [20, 15, 10, 5] }
    },

    // 🏆 REGRAS DO CAMPEONATO (configurações adicionais)
    // Alinhado com pointsService.js e bets.js
    championshipRules: {
      drawIncludesExtraTime: { type: Boolean, default: false },
      podiumSize:            { type: Number, default: 4 }
    },

    // 🏆 RESULTADOS OFICIAIS DO CAMPEONATO (para cálculo de extras)
    // Alinhado com pointsService.js e bets.js
    championshipResults: {
      topScorer:    { type: String, default: null },
      bestAttack:   { type: String, default: null },
      worstDefense: { type: String, default: null },
      upset:        { type: String, default: null }
    },

    // 🏆 PÓDIO OFICIAL (array de strings, tamanho variável)
    // Alinhado com pointsService.js e bets.js — espera array de strings
    podium: {
      type: [String],
      default: []
    },

    // 📋 STATUS DA LIGA
    status: {
      type: String,
      enum: ['active', 'finished', 'paused'],
      default: 'active'
    },

    // Campo auxiliar para buscas se necessário
    key: {
      type: String,
      default: 'league_settings'
    },
    leagueId: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Índice para busca por key (se necessário)
SettingsSchema.index({ key: 1 });

module.exports = mongoose.model('Settings', SettingsSchema);
