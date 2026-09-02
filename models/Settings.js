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

    // ✏️ Permite alterar uma aposta já salva enquanto a partida/grade
    // ainda estiver editável. Não interfere no bloqueio de salvamento.
    allowBetEditingBeforeLock: {
      type: Boolean,
      default: true
    },

    // 🧪 MODO DE TESTE TEMPORÁRIO
    // Permite ao administrador testar regras/apostas sem alterar o
    // firstMatchStartedAt ou o status oficial das partidas.
    testMode: {
      type: Boolean,
      default: false
    },
    testModeBackup: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    /**
     * 🔒 MODO DE BLOQUEIO AUTOMÁTICO DAS APOSTAS
     * grade = primeira partida da grade bloqueia toda a grade
     * match = cada partida bloqueia somente no próprio horário
     */
    betLockMode: {
      type: String,
      enum: ['grade', 'match'],
      default: 'grade'
    },
    groupBetAvailabilityMode: {
      type: String,
      enum: ['all', 'round'],
      default: 'all'
    },
    unlockedGroupRounds: { type: [Number], default: [] },
    lockedGroupRounds: { type: [Number], default: [] },

    pointsRunBetAvailabilityMode: {
      type: String,
      enum: ['all', 'round'],
      default: 'all'
    },
    unlockedPointsRunRounds: { type: [Number], default: [] },
    lockedPointsRunRounds: { type: [Number], default: [] },

    knockoutBetAvailabilityMode: {
      type: String,
      enum: ['all', 'round'],
      default: 'all'
    },
    unlockedKnockoutRounds: { type: [Number], default: [] },
    lockedKnockoutRounds: { type: [Number], default: [] },

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

    // 🔒 MOMENTO EM QUE A PRIMEIRA PARTIDA DA LIGA INICIOU.
    // É permanente: reabrir/reiniciar uma partida não libera as regras.
    firstMatchStartedAt: {
      type: Date,
      default: null
    },

    // 🏆 REGRAS DE PONTUAÇÃO DO CAMPEONATO
    // Alinhado com pointsService.js e bets.js
    scoringRules: {
      exactScore:    { type: Number, default: 5 },
      scoreTeamA:    { type: Number, default: 1 },
      scoreTeamB:    { type: Number, default: 1 },
      winner:        { type: Number, default: 2 },
      topScorer:     { type: Number, default: 10 },
      bestAttack:    { type: Number, default: 10 },
      worstDefense:  { type: Number, default: 10 },
      upset:         { type: Number, default: 15 },
      podiumPoints:  { type: [Number], default: [20, 15, 10, 5] },

      // Extras independentes por partida, exclusivos do mata-mata.
      matchExtras: {
        qualifier: { type: Number, default: 3, min: 0 }
      },

      // Novo construtor de regras de pontuação.
      // Cada item é uma regra; condições dentro da mesma regra são E.
      // Regras diferentes são avaliadas em ordem e funcionam como OU:
      // somente a primeira regra satisfeita concede pontos.
      matchRules: {
        type: [{
          points: { type: Number, required: true, min: 0 },
          conditions: {
            type: [String],
            enum: [
              'exactScore',
              'result',
              'scoreTeamA',
              'scoreTeamB',
              'scoreWinner',
              'scoreLoser',
              'totalGoals',
              'goalDifference'
            ],
            required: true
          }
        }],
        default: []
      },
      groupQualificationRules: {
        type: [{
          points: { type: Number, required: true, min: 0 },
          conditions: {
            type: [String],
            enum: [
              'positionCorrect',
              'positionIncorrect',
              'teamQualified',
              'teamNotQualified'
            ],
            required: true
          }
        }],
        default: []
      }
    },

    // 🏆 REGRAS DO CAMPEONATO (configurações adicionais)
    // Alinhado com pointsService.js e bets.js
    championshipRules: {
      drawIncludesExtraTime: { type: Boolean, default: false },
      winnerFromScore:      { type: Boolean, default: true },
      podiumSize:            { type: Number, default: 4 },
      // Estrutura explícita: sem grupos e sem mata-mata = pontos corridos.
      // Default true preserva o comportamento dos campeonatos antigos.
      hasGroupPhase:        { type: Boolean, default: true },
      hasKnockoutPhase:     { type: Boolean, default: false },
      // Define se o gerador deve criar/manter a disputa pelo 3º lugar.
      // O nome da fase é fixo: '3º lugar'.
      hasThirdPlaceMatch:   { type: Boolean, default: true },
      knockoutFormat: { type: String, enum: ['single', 'home_away'], default: 'single' },
      // Quando o mata-mata geral é ida e volta, permite que a final seja
      // configurada separadamente. Em formato geral de jogo único é ignorado.
      knockoutFinalFormat: { type: String, enum: ['single', 'home_away'], default: 'home_away' },
      knockoutAwayGoals: { type: Boolean, default: false },

      // Estrutura genérica da classificação da fase de grupos.
      // Ex.: 48 times / 12 grupos / 32 classificados =>
      // 2 classificados por grupo + 8 melhores terceiros.
      // Estrutura independente para campeonatos de pontos corridos.
      // Sem grupos e sem mata-mata, a classificação geral usa estes valores.
      pointsRun: {
        totalTeams: { type: Number, default: 0, min: 0 },
        legs: { type: Number, enum: [1, 2], default: 1 }
      },

      groupQualification: {
        totalTeams: { type: Number, default: 0, min: 0 },
        groupCount: { type: Number, default: 0, min: 0 },
        totalQualified: { type: Number, default: 0, min: 0 },
        // 1 = turno único; 2 = turno e returno.
        legs: { type: Number, enum: [1, 2], default: 1 }
      }
    },

    prizeZone: {
      positions: { type: Number, default: 0, min: 0 },
      totalAmount: { type: Number, default: 0, min: 0 },
      distribution: {
        type: [{
          position: { type: Number, required: true, min: 1 },
          percentage: { type: Number, required: true, min: 0, max: 100 }
        }],
        default: []
      }
    },

    rankingRules: {
      tieBreakers: {
        type: [String],
        enum: [
          'exactScorePoints',
          'podiumPoints',
          'extraPoints',
          'knockoutPoints'
        ],
        default: []
      }
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

    // 🕒 EVENTOS USADOS PARA RECONSTRUIR O HISTÓRICO DIÁRIO
    // Registra quando pódio/extras foram definidos ou corrigidos.
    historyEvents: {
      type: [{
        type: {
          type: String,
          enum: [
            'podium_defined',
            'podium_reset',
            'extra_defined'
          ],
          required: true
        },
        key: {
          type: String,
          default: null
        },
        value: {
          type: mongoose.Schema.Types.Mixed,
          default: null
        },
        at: {
          type: Date,
          required: true
        }
      }],
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
