const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * status:
 * - 'scheduled'  (agendado)
 * - 'in_progress' (em andamento)
 * - 'finished'   (finalizado)
 */

const MatchSchema = new Schema(
  {
    matchId: { type: Number, required: true, unique: true, index: true },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    group: { type: String, required: true, trim: true },
    // phase indica se é 'group' (fase de grupos) ou 'knockout' (mata-mata)
    phase: { type: String, enum: ['group','knockout'], default: 'group', index: true },
    stadium: { type: String, default: '', trim: true },

    // Datas no formato texto (DD/MM/AAAA, HH:MM) como você usa no front;
    // se preferir, mude para Date.
    date: { type: String, required: true, trim: true }, // "DD/MM/AAAA"
    time: { type: String, required: true, trim: true }, // "HH:MM"

    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'finished'],
      default: 'scheduled',
      index: true,
    },

    scoreA: { type: Number, default: null, min: 0 },
    scoreB: { type: Number, default: null, min: 0 },

    // Campo opcional para contadores agregados (ex.: betsCount na listagem admin).
    // Você pode mantê-lo como cache se algum pipeline populá-lo.
    betsCount: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ---------- Virtuals ----------
MatchSchema.virtual('isFinished').get(function () {
  return this.status === 'finished';
});

MatchSchema.virtual('winner').get(function () {
  if (this.status !== 'finished') return null;
  const a = typeof this.scoreA === 'number' ? this.scoreA : null;
  const b = typeof this.scoreB === 'number' ? this.scoreB : null;
  if (a === null || b === null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'D'; // draw
});

// ---------- Métodos Estáticos Úteis ----------
/**
 * Finaliza a partida com placar informado.
 */
MatchSchema.statics.finishMatch = async function (matchId, scoreA, scoreB) {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  match.scoreA = Number(scoreA);
  match.scoreB = Number(scoreB);
  match.status = 'finished';

  await match.save();
  return match;
};

/**
 * Reabre (desfinaliza) a partida, limpando placar e voltando status.
 * Útil para testes/simulações.
 */
MatchSchema.statics.unfinishMatch = async function (matchId, statusBack = 'scheduled') {
  const match = await this.findOne({ matchId: Number(matchId) });
  if (!match) throw new Error(`Partida ${matchId} não encontrada`);

  match.status = statusBack; // 'scheduled' (padrão) ou 'in_progress'
  match.scoreA = null;
  match.scoreB = null;

  await match.save();
  return match;
};

/**
 * Exclui a partida definitivamente.
 */
MatchSchema.statics.deleteByMatchId = async function (matchId) {
  const res = await this.deleteOne({ matchId: Number(matchId) });
  if (res.deletedCount === 0) throw new Error(`Partida ${matchId} não encontrada`);
  return true;
};

// ---------- Índices adicionais (se quiser ordenar por grupo+id com frequência) ----------
MatchSchema.index({ group: 1, matchId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', MatchSchema);
