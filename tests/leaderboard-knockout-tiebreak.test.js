'use strict';

const assert = require('assert');
const {
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking
} = require('../services/rankingService');

// 1) Mata-mata só é critério disponível quando a fase existe.
assert.deepStrictEqual(
  normalizeTieBreakers(
    ['knockoutPoints', 'exactScorePoints'],
    { championshipRules: { hasKnockoutPhase: false } }
  ),
  ['exactScorePoints']
);

assert.deepStrictEqual(
  normalizeTieBreakers(
    ['knockoutPoints', 'exactScorePoints'],
    { championshipRules: { hasKnockoutPhase: true } }
  ),
  ['knockoutPoints', 'exactScorePoints']
);

// 2) A métrica de mata-mata deve vir do cálculo atual.
const metrics = getTieBreakerMetrics(
  {},
  {
    exactScorePoints: 0,
    podiumPoints: 0,
    extrasPoints: 0,
    knockoutPoints: 18
  }
);
assert.strictEqual(metrics.knockoutPoints, 18);

// 3) Com total igual, mata-mata desempata quando configurado.
const a = {
  totalPoints: 100,
  tieBreakerMetrics: { knockoutPoints: 18 }
};
const b = {
  totalPoints: 100,
  tieBreakerMetrics: { knockoutPoints: 12 }
};
assert(compareBySportsRanking(a, b, ['knockoutPoints']) < 0);

// 4) Ter pontuação de classificado NÃO habilita o critério se a fase não existir.
assert.deepStrictEqual(
  normalizeTieBreakers(
    ['knockoutPoints'],
    {
      championshipRules: { hasKnockoutPhase: false },
      scoringRules: { qualifier: 5 }
    }
  ),
  []
);

// 5) Com fase existente, o critério funciona mesmo que qualifier seja 0.
assert.deepStrictEqual(
  normalizeTieBreakers(
    ['knockoutPoints'],
    {
      championshipRules: { hasKnockoutPhase: true },
      scoringRules: { qualifier: 0 }
    }
  ),
  ['knockoutPoints']
);

console.log('leaderboard-knockout-tiebreak.test.js: OK');
