'use strict';

/**
 * Regras centrais do formato do mata-mata.
 * knockoutFinalFormat só tem efeito quando o formato geral é ida/volta.
 */
function normalizeKnockoutFormat(value) {
  return value === 'home_away' ? 'home_away' : 'single';
}

function isFinalStage(matchOrStage) {
  const value = typeof matchOrStage === 'string'
    ? matchOrStage
    : (
      matchOrStage?.phaseName ||
      matchOrStage?.roundName ||
      matchOrStage?.group ||
      ''
    );

  const s = String(value).trim().toLowerCase();

  return (
    s === 'final' ||
    s.startsWith('final ') ||
    s.startsWith('final-') ||
    s === 'finalissima' ||
    s === 'finalíssima'
  );
}

function getEffectiveKnockoutFormat(championshipRules = {}, matchOrStage = {}) {
  const globalFormat = normalizeKnockoutFormat(championshipRules?.knockoutFormat);

  if (globalFormat === 'single') return 'single';

  if (isFinalStage(matchOrStage)) {
    return normalizeKnockoutFormat(
      championshipRules?.knockoutFinalFormat || 'home_away'
    );
  }

  return 'home_away';
}

function getEffectiveKnockoutLegCount(championshipRules = {}, matchOrStage = {}) {
  return getEffectiveKnockoutFormat(championshipRules, matchOrStage) === 'home_away'
    ? 2
    : 1;
}

function normalizeTeamKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Gera a identidade determinística de um confronto a partir da etapa
 * e das equipes. A ordem das equipes não importa.
 */
function buildKnockoutTieKey(matchOrStage, teamA, teamB) {
  const stage = normalizeTeamKey(
    typeof matchOrStage === 'string'
      ? matchOrStage
      : (
        matchOrStage?.phaseName ||
        matchOrStage?.roundName ||
        matchOrStage?.group ||
        ''
      )
  );

  const teams = [
    normalizeTeamKey(teamA),
    normalizeTeamKey(teamB)
  ].sort();

  if (!stage || !teams[0] || !teams[1]) return null;

  return `${stage}::${teams[0]}::${teams[1]}`;
}

module.exports = {
  normalizeKnockoutFormat,
  isFinalStage,
  getEffectiveKnockoutFormat,
  getEffectiveKnockoutLegCount,
  normalizeTeamKey,
  buildKnockoutTieKey
};
