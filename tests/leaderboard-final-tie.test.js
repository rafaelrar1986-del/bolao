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

const rows = [
  { user:{name:'João'}, totalPoints:100, computed:{
      exactScorePoints:20,podiumPoints:0,extrasPoints:0,knockoutPoints:30 }},
  { user:{name:'Maria'}, totalPoints:100, computed:{
      exactScorePoints:20,podiumPoints:0,extrasPoints:0,knockoutPoints:30 }},
  { user:{name:'Pedro'}, totalPoints:90, computed:{
      exactScorePoints:10,podiumPoints:0,extrasPoints:0,knockoutPoints:20 }}
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
  [['João',1],['Maria',1],['Pedro',3]]
);

const awards = calculatePrizeAllocation(positioned, settings.prizeZone);

assert.deepStrictEqual(
  awards.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.position,x.prizeAmount]),
  [
    ['João',1,4000],
    ['Maria',1,4000],
    ['Pedro',3,2000]
  ]
);

// Agora 3 empatados definitivamente em 1º.
// O grupo ocupa 1º, 2º e 3º; os três percentuais são somados.
const three = [
  { user:{name:'A'}, totalPoints:100, computed:{
      exactScorePoints:10,podiumPoints:0,extrasPoints:0,knockoutPoints:20 }},
  { user:{name:'B'}, totalPoints:100, computed:{
      exactScorePoints:10,podiumPoints:0,extrasPoints:0,knockoutPoints:20 }},
  { user:{name:'C'}, totalPoints:100, computed:{
      exactScorePoints:10,podiumPoints:0,extrasPoints:0,knockoutPoints:20 }},
  { user:{name:'D'}, totalPoints:80, computed:{
      exactScorePoints:5,podiumPoints:0,extrasPoints:0,knockoutPoints:10 }}
];

for (const row of three) {
  row.tieBreakerMetrics = getTieBreakerMetrics({}, row.computed);
  row.__rankingTieKey = JSON.stringify(
    tieBreakers.map(k => Number(row.tieBreakerMetrics?.[k] || 0))
  );
}
three.sort((a,b) => {
  const r = compareBySportsRanking(a,b,tieBreakers);
  return r !== 0 ? r : String(a.user.name).localeCompare(String(b.user.name),'pt-BR');
});

const threePos = assignSportsPositions(three);
assert.deepStrictEqual(
  threePos.map(x=>[x.user.name,x.position]),
  [['A',1],['B',1],['C',1],['D',4]]
);

const threeAwards = calculatePrizeAllocation(threePos, settings.prizeZone);
assert.deepStrictEqual(
  threeAwards.filter(x=>x.prizeEligible).map(x=>x.prizeAmount),
  [3333.33,3333.33,3333.33]
);

const paid = Number(threeAwards
  .filter(x=>x.prizeEligible)
  .reduce((s,x)=>s+Number(x.prizeAmount||0),0)
  .toFixed(2));
assert.strictEqual(paid, 9999.99);
assert.strictEqual(Number((10000-paid).toFixed(2)), 0.01);

console.log('leaderboard-final-tie.test.js: OK');
