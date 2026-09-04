// admin/adminConstants.js
// Constantes estáveis do painel administrativo. Sem efeitos colaterais.

export const STATUS_LABELS = {
  scheduled: 'Agendado',
  '1_tempo': '1º Tempo',
  intervalo: 'Intervalo',
  '2_tempo': '2º Tempo',
  prorrogacao: 'Prorrogação',
  penaltis: 'Pênaltis',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
  postponed: 'Adiado'
};

export const DEFAULT_SCORING = {
  exactScore: 5,
  scoreTeamA: 1,
  scoreTeamB: 1,
  winner: 2,
  topScorer: 10,
  bestAttack: 10,
  worstDefense: 10,
  upset: 15,
  podiumPoints: [20, 15, 10, 5],
  matchRules: []
};

export const DEFAULT_CHAMPIONSHIP_RULES = {
  drawIncludesExtraTime: false,
  winnerFromScore: true,
  podiumSize: 4,
  hasGroupPhase: true,
  hasKnockoutPhase: false,
  hasThirdPlaceMatch: true,
  knockoutFormat: 'single',
  knockoutFinalFormat: 'single',
  knockoutAwayGoals: false,
  pointsRun: { totalTeams: 0, legs: 1 },
  groupQualification: {
    totalTeams: 0,
    groupCount: 0,
    totalQualified: 0,
    legs: 1
  }
};

export const SAVE_LOCK_KEYS = {
  bets: 'bolao_block_save_bets',
  knockout: 'bolao_block_save_knockout',
  requireAll: 'bolao_require_all_group_bets'
};
