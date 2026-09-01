'use strict';

const Match = require('../models/Match');
const {
  getEffectiveKnockoutFormat,
  getEffectiveKnockoutLegCount,
  buildKnockoutTieKey
} = require('../utils/knockoutFormat');

function parseDateTime(match) {
  const [d, m, y] = String(match?.date || '').split('/').map(Number);
  const [hh, mm] = String(match?.time || '00:00').split(':').map(Number);
  if (!d || !m || !y) return Number.MAX_SAFE_INTEGER;
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
}

/**
 * Materializa a identidade do confronto e a perna de todas as partidas
 * pertencentes ao mesmo confronto.
 *
 * Importante: se a partida já possui knockoutTieKey, ela é preservada.
 * Isso evita que uma alteração posterior nos nomes das equipes quebre
 * a identidade do confronto.
 */
async function materializeKnockoutConfrontation(match, rules = {}) {
  if (!match || match.phase !== 'knockout') return [];

  const stageFormat = getEffectiveKnockoutFormat(rules, match);
  const expectedLegs = getEffectiveKnockoutLegCount(rules, match);

  const existingKey = String(match.knockoutTieKey || '').trim();
  const tieKey = existingKey || buildKnockoutTieKey(match, match.teamA, match.teamB);

  if (!tieKey) {
    match.stageFormat = stageFormat;
    match.knockoutExpectedLegs = expectedLegs;
    match.knockoutLeg = 1;
    return [match];
  }

  match.stageFormat = stageFormat;
  match.knockoutExpectedLegs = expectedLegs;
  match.knockoutTieKey = tieKey;

  const candidates = await Match.find({
    leagueId: match.leagueId,
    phase: 'knockout',
    knockoutTieKey: tieKey
  });

  if (!candidates.some(c => String(c._id) === String(match._id))) {
    candidates.push(match);
  }

  candidates.sort((a, b) =>
    parseDateTime(a) - parseDateTime(b) ||
    Number(a.matchId) - Number(b.matchId)
  );

  const ops = [];
  for (let i = 0; i < candidates.length; i++) {
    const leg = i + 1;
    const candidate = candidates[i];

    candidate.stageFormat = stageFormat;
    candidate.knockoutExpectedLegs = expectedLegs;
    candidate.knockoutTieKey = tieKey;
    candidate.knockoutLeg = leg;

    // O caller pode precisar do documento atualizado em memória.
    if (String(candidate._id) === String(match._id)) {
      match.stageFormat = stageFormat;
      match.knockoutExpectedLegs = expectedLegs;
      match.knockoutTieKey = tieKey;
      match.knockoutLeg = leg;
    }

    ops.push({
      updateOne: {
        filter: { _id: candidate._id },
        update: {
          $set: {
            stageFormat,
            knockoutExpectedLegs: expectedLegs,
            knockoutTieKey: tieKey,
            knockoutLeg: leg
          }
        }
      }
    });
  }

  if (ops.length) await Match.bulkWrite(ops);

  return candidates;
}

module.exports = {
  materializeKnockoutConfrontation
};
