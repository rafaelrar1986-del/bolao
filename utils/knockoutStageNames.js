'use strict';

// Fonte única dos nomes de fases usados pelo criador de partidas.
// A Estratégia deve consumir exatamente estes nomes para não criar aliases
// próprios que possam divergir das partidas gravadas no MongoDB.
const KNOCKOUT_STAGE_NAMES = Object.freeze({
  ROUND_32: '16-avos de final',
  ROUND_16: 'Oitavas de final',
  QUARTERFINALS: 'Quartas de final',
  SEMIFINAL: 'Semifinal',
  FINAL: 'Final',
  THIRD_PLACE: '3º lugar'
});

const API_KNOCKOUT_ROUND_MAP = Object.freeze({
  'Round of 32': KNOCKOUT_STAGE_NAMES.ROUND_32,
  'Round of 16': KNOCKOUT_STAGE_NAMES.ROUND_16,
  'Quarterfinals': KNOCKOUT_STAGE_NAMES.QUARTERFINALS,
  'Semifinals': KNOCKOUT_STAGE_NAMES.SEMIFINAL,
  'Match for 3rd place': KNOCKOUT_STAGE_NAMES.THIRD_PLACE,
  'Final': KNOCKOUT_STAGE_NAMES.FINAL
});

const CANONICAL_BY_NORMALIZED = new Map([
  [KNOCKOUT_STAGE_NAMES.ROUND_32.toLowerCase(), KNOCKOUT_STAGE_NAMES.ROUND_32],
  [KNOCKOUT_STAGE_NAMES.ROUND_16.toLowerCase(), KNOCKOUT_STAGE_NAMES.ROUND_16],
  [KNOCKOUT_STAGE_NAMES.QUARTERFINALS.toLowerCase(), KNOCKOUT_STAGE_NAMES.QUARTERFINALS],
  [KNOCKOUT_STAGE_NAMES.SEMIFINAL.toLowerCase(), KNOCKOUT_STAGE_NAMES.SEMIFINAL],
  [KNOCKOUT_STAGE_NAMES.FINAL.toLowerCase(), KNOCKOUT_STAGE_NAMES.FINAL],
  [KNOCKOUT_STAGE_NAMES.THIRD_PLACE.toLowerCase(), KNOCKOUT_STAGE_NAMES.THIRD_PLACE]
]);

function normalizeKnockoutStageName(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(API_KNOCKOUT_ROUND_MAP, raw)) {
    return API_KNOCKOUT_ROUND_MAP[raw];
  }
  return CANONICAL_BY_NORMALIZED.get(raw.toLowerCase()) || null;
}

module.exports = {
  KNOCKOUT_STAGE_NAMES,
  API_KNOCKOUT_ROUND_MAP,
  normalizeKnockoutStageName
};
