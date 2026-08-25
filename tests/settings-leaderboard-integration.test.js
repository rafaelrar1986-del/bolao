'use strict';

const assert = require('assert');
const {
  normalizeTieBreakers,
  calculatePrizeAllocation
} = require('../services/rankingService');

// Estrutura equivalente à que o leaderboard consome de Settings.
const settings = {
  championshipRules: {
    hasKnockoutPhase: true
  },
  rankingRules: {
    tieBreakers: [
      'knockoutPoints',
      'exactScorePoints',
      'extraPoints'
    ]
  },
  prizeZone: {
    positions: 3,
    totalAmount: 10000,
    distribution: [
      { position: 1, percentage: 50 },
      { position: 2, percentage: 30 },
      { position: 3, percentage: 20 }
    ]
  }
};

assert.deepStrictEqual(
  normalizeTieBreakers(settings.rankingRules.tieBreakers, settings),
  ['knockoutPoints','exactScorePoints','extraPoints']
);

const ranking = [
  {user:{name:'João'},position:1,totalPoints:100},
  {user:{name:'Maria'},position:1,totalPoints:100},
  {user:{name:'Pedro'},position:3,totalPoints:90}
];

const result = calculatePrizeAllocation(ranking, settings.prizeZone);

assert.deepStrictEqual(
  result.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['João',4000],['Maria',4000],['Pedro',2000]]
);

console.log('settings-leaderboard-integration.test.js: OK');
