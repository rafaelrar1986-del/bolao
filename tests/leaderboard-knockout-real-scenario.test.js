'use strict';

const assert = require('assert');
const {
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
} = require('../services/rankingService');

// CENÁRIO REAL:
// Campeonato possui mata-mata.
// Critério 1 = maior pontuação em mata-mata.
// Critério 2 = maior pontuação em placar exato.
// Zona = 3 posições.
// 1º recebe 50%, 2º 30%, 3º 20%.

const settings = {
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: {
    tieBreakers: ['knockoutPoints', 'exactScorePoints']
  }
};

const tieBreakers = normalizeTieBreakers(
  settings.rankingRules.tieBreakers,
  settings
);

assert.deepStrictEqual(
  tieBreakers,
  ['knockoutPoints', 'exactScorePoints']
);

// Quatro participantes:
// João e Maria têm o mesmo total.
// Mata-mata resolve o empate.
// Pedro e Ana têm o mesmo total e o mesmo mata-mata;
// placar exato resolve o segundo empate.
const ranking = [
  {
    user: { name: 'João' },
    totalPoints: 100,
    tieBreakerMetrics: {
      knockoutPoints: 30,
      exactScorePoints: 10
    }
  },
  {
    user: { name: 'Maria' },
    totalPoints: 100,
    tieBreakerMetrics: {
      knockoutPoints: 20,
      exactScorePoints: 50
    }
  },
  {
    user: { name: 'Pedro' },
    totalPoints: 90,
    tieBreakerMetrics: {
      knockoutPoints: 15,
      exactScorePoints: 20
    }
  },
  {
    user: { name: 'Ana' },
    totalPoints: 90,
    tieBreakerMetrics: {
      knockoutPoints: 15,
      exactScorePoints: 10
    }
  }
];

for (const row of ranking) {
  row.__rankingTieKey = JSON.stringify(
    tieBreakers.map(k => Number(row.tieBreakerMetrics?.[k] || 0))
  );
}

ranking.sort((a,b) => {
  const r = compareBySportsRanking(a,b,tieBreakers);
  return r !== 0 ? r : a.user.name.localeCompare(b.user.name);
});

const positioned = assignSportsPositions(ranking);

assert.deepStrictEqual(
  positioned.map(x => [x.user.name, x.position]),
  [
    ['João', 1],
    ['Maria', 2],
    ['Pedro', 3],
    ['Ana', 4]
  ]
);

// Premiação: 3 posições.
// João 1º = 50%, Maria 2º = 30%, Pedro 3º = 20%.
const awarded = calculatePrizeAllocation(positioned, {
  positions: 3,
  totalAmount: 10000,
  distribution: [
    { position: 1, percentage: 50 },
    { position: 2, percentage: 30 },
    { position: 3, percentage: 20 }
  ]
});

assert.deepStrictEqual(
  awarded.filter(x => x.prizeEligible).map(x => [x.user.name, x.position, x.prizeAmount]),
  [
    ['João', 1, 5000],
    ['Maria', 2, 3000],
    ['Pedro', 3, 2000]
  ]
);

// Teste de empate definitivo: mesmo total + mesmo mata-mata + mesmo placar exato.
// Devem permanecer 1º/1º e o prêmio de 1º + 2º deve ser dividido.
const tied = [
  {
    user: { name: 'Carlos' },
    totalPoints: 100,
    tieBreakerMetrics: { knockoutPoints: 25, exactScorePoints: 10 }
  },
  {
    user: { name: 'Bruno' },
    totalPoints: 100,
    tieBreakerMetrics: { knockoutPoints: 25, exactScorePoints: 10 }
  },
  {
    user: { name: 'Diego' },
    totalPoints: 80,
    tieBreakerMetrics: { knockoutPoints: 10, exactScorePoints: 5 }
  }
];

tied.sort((a,b) => {
  const r = compareBySportsRanking(a,b,tieBreakers);
  return r !== 0 ? r : a.user.name.localeCompare(b.user.name);
});

const tiedPositioned = assignSportsPositions(tied);

assert.deepStrictEqual(
  tiedPositioned.map(x => [x.user.name, x.position]),
  [
    ['Bruno', 1],
    ['Carlos', 1],
    ['Diego', 3]
  ]
);

const tiedAwarded = calculatePrizeAllocation(tiedPositioned, {
  positions: 3,
  totalAmount: 10000,
  distribution: [
    { position: 1, percentage: 50 },
    { position: 2, percentage: 30 },
    { position: 3, percentage: 20 }
  ]
});

assert.deepStrictEqual(
  tiedAwarded.filter(x => x.prizeEligible).map(x => [x.user.name, x.prizeAmount]),
  [
    ['Bruno', 4000],
    ['Carlos', 4000],
    ['Diego', 2000]
  ]
);

console.log('leaderboard-knockout-real-scenario.test.js: OK');
