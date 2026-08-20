const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Status Detalhado: Sincronizado com statusMap do Updater
 */
const MatchSchema = new Schema(
  {
    // ID Único da partida
    matchId: { type: Number, required: true, unique: true, index: true },

    // IDENTIFICAÇÃO DA LIGA — Padronizado como String para consistência com Bet, PointsHistory, NewsMessage, Settings
    leagueId: { type: String, required: false, index: true },
    leagueName: { type: String, default: '' },

    phaseName: { type: String, required: false, trim: true },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    logoA: { type: String, default: '' },
    logoB: { type: String, default: '' },

    group: { type: String, required: true, trim: true },
    // 🎯 Fase: 'group' (fase de grupos) | 'knockout' (mata-mata) | 'pontos_corridos'
    phase: { 
      type: String, 
      enum: ['group', 'knockout', 'pontos_corridos'], 
      default: 'group', 
      index: true 
    },

    // 🏆 QUEM PASSOU DE FASE (Definido prioritariamente pelos Pênaltis)
    qualifiedSide: { type: String, enum: ['A', 'B', null], default: null },

    // 🆕 FLAG: Indica se o qualifiedSide foi forçado manualmente pelo admin.
    // Quando true, o pre('save') NÃO recalcula automaticamente.
    qualifiedSideManuallySet: { type: Boolean, default: false },

    stadium: { type: String, default: '', trim: true },

    date: { type: String, required: true, trim: true }, // "DD/MM/AAAA"
    time: { type: String, required: true, trim: true }, // "HH:MM"

    status: {
      type: String,
      enum: [
        'scheduled', '1_tempo', 'intervalo', '2_tempo', 'prorrogacao',
        '1_tet', '2_tet', 'penaltis', 'finished', 'cancelled', 'postponed'
      ],
      default: 'scheduled',
      index: true,
    },

    // Placar Final (Inclui Gols da Prorrogação se houver)
    scoreA: { type: Number, default: null, min: 0 },
    scoreB: { type: Number, default: null, min: 0 },

    // 🌟 NOVOS CAMPOS: Placar exato dos 90 minutos (Tempo Normal)
    regularTimeScoreA: { type: Number, default: null, min: 0 },
    regularTimeScoreB: { type: Number, default: null, min: 0 },

    penaltiesA: { type: Number, default: null },
    penaltiesB: { type: Number, default: null },

    // --- 🚀 DETALHAMENTO DE PÊNALTIS PARA O FRONT-END ---
    shootoutDetail: { type: Array, default: [] },

    // --- CAMPOS ALINHADOS AO UPDATER (SPATIAL=TRUE) ---
    xg: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 }
    },
    odds: {
      home: { type: Number, default: null },
      draw: { type: Number, default: null },
      away: { type: Number, default: null }
    },
    unavailable: { type: Array, default: [] }, // Desfalques
    ai_analysis: { type: String, default: '' }, // Preview de IA
    video_url: { type: String, default: '' },   // Highlights
    // -----------------------------------------------------------

    // EVENTOS COMPLETOS (Gols, VAR, Substituições)
    goalsDetail: [
      {
        type: { type: String },
        name: { type: String },
        min: { type: Number },
        extra: { type: Number },
        side: { type: String, enum: ['home', 'away'] },
        description: { type: String },
        playerIn: { type: String },
        playerOut: { type: String }
      }
    ],

    possession: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 }
    },

    statistics: { type: Array, default: [] }, // live_stats

    lineups: {
      home: {
        formation: { type: String, default: "" },
        players: { type: Array, default: [] },
        substitutes: { type: Array, default: [] }
      },
      away: {
        formation: { type: String, default: "" },
        players: { type: Array, default: [] },
        substitutes: { type: Array, default: [] }
      },
      confirmed: { type: Boolean, default: false }
    },
    apiStatus: { type: String, default: 'NS' },
    minute: { type: String, default: '' },

    processed: { type: Boolean, default: false },

    betsCount: { type: Number, default: 0 },
    apiId: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },

    // 🚨 NOVOS CAMPOS DE CONTROLE PARA SUPORTE À V2 E IGNORAR SE SLEEP NO RENDER
    scoutsConsolidated: { type: Boolean, default: false, index: true },
    apiLastUpdated: { type: String, default: null }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ---------- Middlewares ----------

MatchSchema.pre('save', function (next) {
  const isKnockout = this.phase === 'knockout';

  if (isKnockout && this.qualifiedSideManuallySet !== true) {
    const sA = this.scoreA;
    const sB = this.scoreB;
    const pA = this.penaltiesA;
    const pB = this.penaltiesB;

    // 1. Prioridade Máxima: Pênaltis (Cálculo automático se houver disputa)
    if (pA !== null && pB !== null && pA !== pB) {
      this.qualifiedSide = pA > pB ? 'A' : 'B';
    }
    // 2. Segunda Prioridade: Gols (Se não houve pênaltis ou não terminou em empate)
    else if (sA !== null && sB !== null && sA !== sB) {
      this.qualifiedSide = sA > sB ? 'A' : 'B';
    }
    // 3. Caso de Empate Real ou dados inconclusivos
    else {
      this.qualifiedSide = null;
    }
  }

  next();
});

// ---------- Virtuals ----------

MatchSchema.virtual('isFinished').get(function () {
  return this.status === 'finished';
});

MatchSchema.virtual('isLive').get(function () {
  const liveStatus = ['1_tempo', 'intervalo', '2_tempo', 'prorrogacao', '1_tet', '2_tet', 'penaltis'];
  return liveStatus.includes(this.status);
});

/**
 * 🎯 VENCEDOR BRUTO (Placar Final): Considera scoreA e scoreB (Tempo normal + prorrogação).
 * Retorna 'A', 'B' ou 'draw'. IGNORA pênaltis.
 */
MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;

  const a = this.scoreA;
  const b = this.scoreB;
  if (a === null || b === null) return null;

  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
});

/**
 * 🎯 VENCEDOR DO TEMPO NORMAL: Considera apenas regularTimeScoreA/B (90 min).
 * Útil quando drawIncludesExtraTime = false.
 * Retorna 'A', 'B' ou 'draw'.
 */
MatchSchema.virtual('regularTimeWinner').get(function () {
  if (this.status !== 'finished') return null;

  const a = this.regularTimeScoreA;
  const b = this.regularTimeScoreB;

  // Se não tiver tempo normal registrado, fallback para o winner final
  if (a == null || b == null) return this.winner;

  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
});

// ---------- Métodos de Instância ----------

/**
 * 🎯 VENCEDOR PARA O BOLÃO: Respeita a regra drawIncludesExtraTime da liga.
 *
 * @param {Object} rules - Objeto championshipRules da Settings (ou { drawIncludesExtraTime: boolean })
 * @returns {String|null} 'A' | 'B' | 'draw' | null
 */
MatchSchema.methods.getWinnerForBet = function (rules = {}) {
  if (this.status !== 'finished') return null;

  const drawIncludesExtraTime = rules?.drawIncludesExtraTime ?? false;

  if (drawIncludesExtraTime) {
    return this.winner;
  }

  return this.regularTimeWinner;
};

// ---------- Métodos Estáticos ----------

MatchSchema.statics.getByLeague = function (leagueId) {
  return this.find({ leagueId: String(leagueId) }).sort({ date: 1, time: 1 });
};

/**
 * 🎯 Utilidade: Calcula o vencedor de uma partida para o bolão sem precisar do documento completo.
 *
 * @param {Object} match - Objeto com scoreA, scoreB, regularTimeScoreA, regularTimeScoreB, status
 * @param {Object} rules - Objeto championshipRules da Settings (ou { drawIncludesExtraTime: boolean })
 * @returns {String|null} 'A' | 'B' | 'draw' | null
 */
MatchSchema.statics.getWinnerForBet = function (match, rules = {}) {
  if (match.status !== 'finished') return null;

  const drawIncludesExtraTime = rules?.drawIncludesExtraTime ?? false;

  if (drawIncludesExtraTime) {
    const a = match.scoreA;
    const b = match.scoreB;
    if (a === null || b === null) return null;
    if (a > b) return 'A';
    if (b > a) return 'B';
    return 'draw';
  }

  let a = match.regularTimeScoreA;
  let b = match.regularTimeScoreB;

  // Fallback para placar final se tempo normal não estiver disponível
  if (a === null || b === null) {
    a = match.scoreA;
    b = match.scoreB;
  }

  if (a === null || b === null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
};

/**
 * 🌟 Finaliza uma partida e gerencia o qualifiedSide com suporte a override manual do admin.
 *
 * @param {Number} matchId
 * @param {Number} scoreA
 * @param {Number} scoreB
 * @param {Number|null} penA
 * @param {Number|null} penB
 * @param {Number|null} regA
 * @param {Number|null} regB
 * @param {String|null} qSide — override manual do admin ('A' ou 'B')
 */
MatchSchema.statics.finishMatch = async function (matchId, scoreA, scoreB, penA = null, penB = null, regA = null, regB = null, qSide = null) {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  // 🆕 CORREÇÃO: Protege contra Number(null) === 0
  const newScoreA = scoreA !== null && scoreA !== undefined ? Number(scoreA) : null;
  const newScoreB = scoreB !== null && scoreB !== undefined ? Number(scoreB) : null;
  const newRegA = regA !== null && regA !== undefined ? Number(regA) : null;
  const newRegB = regB !== null && regB !== undefined ? Number(regB) : null;

  const qSideWillChange = qSide !== null && ['A', 'B'].includes(qSide) && match.qualifiedSide !== qSide;

  // 🆕 CORREÇÃO: Early return considera também alterações no tempo normal e override de qualifiedSide
  if (match.status === 'finished' &&
      match.scoreA === newScoreA &&
      match.scoreB === newScoreB &&
      match.regularTimeScoreA === newRegA &&
      match.regularTimeScoreB === newRegB &&
      !qSideWillChange) {
    return match;
  }

  match.scoreA = newScoreA;
  match.scoreB = newScoreB;

  // Salva o tempo normal se fornecido, senão mantém null
  match.regularTimeScoreA = newRegA;
  match.regularTimeScoreB = newRegB;

  match.penaltiesA = penA !== null && penA !== undefined ? Number(penA) : null;
  match.penaltiesB = penB !== null && penB !== undefined ? Number(penB) : null;
  match.status = 'finished';
  match.minute = "Fim";
  match.scoutsConsolidated = true; // Força como consolidado se finalizado manualmente via static

  // Se o admin forçou explicitamente o qualifiedSide, marca a flag ANTES do save
  // para que o pre('save') não sobrescreva.
  if (qSide !== null && ['A', 'B'].includes(qSide)) {
    match.qualifiedSide = qSide;
    match.qualifiedSideManuallySet = true;
  }

  await match.save();

  // Retorna documento atualizado (com ou sem override)
  return this.findOne({ matchId: Number(matchId) });
};

/**
 * 🌟 Reabre uma partida finalizada, limpando todos os campos de resultado.
 */
MatchSchema.statics.unfinishMatch = async function (matchId, statusBack = 'scheduled') {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  // 🆕 CORREÇÃO: Early return se já estiver no estado desejado
  if (match.status === statusBack && match.scoreA === null && match.scoreB === null) {
    return match;
  }

  match.status = statusBack;
  match.scoreA = null;
  match.scoreB = null;
  match.regularTimeScoreA = null;
  match.regularTimeScoreB = null;
  match.penaltiesA = null;
  match.penaltiesB = null;
  match.qualifiedSide = null;
  match.qualifiedSideManuallySet = false; // 🆕 Reseta a flag manual
  match.minute = "";
  match.processed = false;
  match.scoutsConsolidated = false; // Libera novamente para processamento do robô
  match.apiLastUpdated = null;
  match.goalsDetail = [];
  match.statistics = [];
  match.shootoutDetail = [];

  // 🆕 CORREÇÃO: Reseta lineups preservando a estrutura do schema (evita undefined)
  match.lineups = {
    home: { formation: "", players: [], substitutes: [] },
    away: { formation: "", players: [], substitutes: [] },
    confirmed: false
  };

  // 🆕 CORREÇÃO: Limpa campos avançados também para reset completo
  match.possession = { home: 0, away: 0 };
  match.xg = { home: 0, away: 0 };
  match.odds = { home: null, draw: null, away: null };
  match.unavailable = [];
  match.ai_analysis = '';
  match.video_url = '';
  match.apiStatus = 'NS'; // 🆕 CORREÇÃO: Reseta status da API

  await match.save();
  return match;
};

MatchSchema.index({ leagueId: 1, group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);