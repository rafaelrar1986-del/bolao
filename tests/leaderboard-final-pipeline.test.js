'use strict';

const assert = require('assert');
const {
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
} = require('../services/rankingService');

const settings = {
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: {
    tieBreakers: ['knockoutPoints', 'exactScorePoints']
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

const tieBreakers = normalizeTieBreakers(settings.rankingRules.tieBreakers, settings);
assert.deepStrictEqual(tieBreakers, ['knockoutPoints','exactScorePoints']);

const rows = [
  { user:{name:'João'}, totalPoints:100, computed:{
      exactScorePoints:10,podiumPoints:0,extrasPoints:0,knockoutPoints:30 }},
  { user:{name:'Maria'}, totalPoints:100, computed:{
      exactScorePoints:50,podiumPoints:0,extrasPoints:0,knockoutPoints:20 }},
  { user:{name:'Pedro'}, totalPoints:90, computed:{
      exactScorePoints:20,podiumPoints:0,extrasPoints:0,knockoutPoints:15 }},
  { user:{name:'Ana'}, totalPoints:90, computed:{
      exactScorePoints:10,podiumPoints:0,extrasPoints:0,knockoutPoints:15 }}
];

for (const row of rows) {
  row.tieBreakerMetrics = getTieBreakerMetrics({}, row.computed);
  row.__rankingTieKey = JSON.stringify(
    tieBreakers.map(k => Number(row.tieBreakerMetrics?.[k] || 0))
  );
}

rows.sort((a,b) => {
  const r = compareBySportsRanking(a,b,tieBreakers);
  return r !== 0 ? r : String(a.user.name).localeCompare(String(b.user.name),'pt-BR');
});

const positioned = assignSportsPositions(rows);
assert.deepStrictEqual(
  positioned.map(x => [x.user.name,x.position]),
  [['João',1],['Maria',2],['Pedro',3],['Ana',4]]
);

// Empate definitivo em 3º: 3º+4º; 4º tem 0% e a zona termina em 3º.
// O grupo deve permanecer elegível, e o valor do grupo é dividido.
const awards = calculatePrizeAllocation(positioned, settings.prizeZone);
const paid = awards.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.position,x.prizeAmount]);

assert.deepStrictEqual(paid, [
  ['João',1,5000],
  ['Maria',2,3000],
  ['Pedro',3,2000]
]);

console.log('leaderboard-final-pipeline.test.js: OK');
