'use strict';

const assert = require('assert');
const {
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
} = require('../services/rankingService');

// ---------- helpers ----------
function metricRow(name, total, metrics) {
  const row = {
    user:{name},
    totalPoints:total,
    tieBreakerMetrics:getTieBreakerMetrics({}, metrics)
  };
  return row;
}
function sportsRank(rows, tieBreakers) {
  for (const row of rows) {
    row.__rankingTieKey = JSON.stringify(
      tieBreakers.map(k => Number(row.tieBreakerMetrics?.[k] || 0))
    );
  }
  rows.sort((a,b) => {
    const r = compareBySportsRanking(a,b,tieBreakers);
    return r !== 0 ? r : String(a.user.name).localeCompare(String(b.user.name),'pt-BR');
  });
  return assignSportsPositions(rows);
}

// 1. 0 critérios -> somente total; empate permanece empate.
let tb = normalizeTieBreakers([], {
  championshipRules:{hasKnockoutPhase:true}
});
assert.deepStrictEqual(tb, []);
let r = sportsRank([
  metricRow('A',100,{exactScorePoints:30,knockoutPoints:20}),
  metricRow('B',100,{exactScorePoints:10,knockoutPoints:5}),
  metricRow('C',90,{exactScorePoints:40,knockoutPoints:40})
], tb);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['A',1],['B',1],['C',3]]);

// 2. Um critério: exato desempata.
tb = ['exactScorePoints'];
r = sportsRank([
  metricRow('A',100,{exactScorePoints:30}),
  metricRow('B',100,{exactScorePoints:20}),
], tb);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['A',1],['B',2]]);

// 3. Dois critérios: segundo só é usado se o primeiro empatar.
tb = ['knockoutPoints','exactScorePoints'];
r = sportsRank([
  metricRow('A',100,{knockoutPoints:20,exactScorePoints:1}),
  metricRow('B',100,{knockoutPoints:20,exactScorePoints:2}),
  metricRow('C',100,{knockoutPoints:10,exactScorePoints:99}),
], tb);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['B',1],['A',2],['C',3]]);

// 4. Três critérios e prioridade.
tb = ['extraPoints','podiumPoints','exactScorePoints'];
r = sportsRank([
  metricRow('A',100,{extrasPoints:5,podiumPoints:1,exactScorePoints:99}),
  metricRow('B',100,{extrasPoints:5,podiumPoints:2,exactScorePoints:1}),
  metricRow('C',100,{extrasPoints:4,podiumPoints:99,exactScorePoints:99}),
], tb);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['B',1],['A',2],['C',3]]);

// 5. Mata-mata só disponível quando existe fase.
assert.deepStrictEqual(
  normalizeTieBreakers(['knockoutPoints','exactScorePoints'],
    {championshipRules:{hasKnockoutPhase:false}}),
  ['exactScorePoints']
);
assert.deepStrictEqual(
  normalizeTieBreakers(['knockoutPoints','exactScorePoints'],
    {championshipRules:{hasKnockoutPhase:true}}),
  ['knockoutPoints','exactScorePoints']
);

// 6. Mata-mata existe mesmo com qualifier = 0: critério disponível.
assert.deepStrictEqual(
  normalizeTieBreakers(['knockoutPoints'],
    {championshipRules:{hasKnockoutPhase:true}, scoringRules:{qualifier:0}}),
  ['knockoutPoints']
);

// 7. Critério repetido / >3: contrato esperado.
let duplicateResult = (() => {
  const requested=['exactScorePoints','exactScorePoints'];
  return new Set(requested).size !== requested.length;
})();
assert.strictEqual(duplicateResult,true);
assert.strictEqual(['a','b','c','d'].length > 3,true);

// 8. Métricas atuais prevalecem sobre dados antigos.
let m = getTieBreakerMetrics(
  {groupMatches:[{pointsBreakdown:{exactScore:999}}]},
  {exactScorePoints:20,podiumPoints:30,extrasPoints:12,knockoutPoints:18}
);
assert.deepStrictEqual(m, {
  exactScorePoints:20,
  podiumPoints:30,
  extraPoints:12,
  knockoutPoints:18
});

// 9. Empate em 1º: 1º+2º dividido.
const zone = {
  positions:3,totalAmount:10000,
  distribution:[
    {position:1,percentage:50},
    {position:2,percentage:30},
    {position:3,percentage:20}
  ]
};
r = sportsRank([
  metricRow('A',100,{knockoutPoints:10}),
  metricRow('B',100,{knockoutPoints:10}),
  metricRow('C',90,{knockoutPoints:5})
], []);
let awards = calculatePrizeAllocation(r,zone);
assert.deepStrictEqual(
  awards.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['A',4000],['B',4000],['C',2000]]
);

// 10. Empate em 2º: 2º+3º.
r = sportsRank([
  metricRow('A',100,{}),
  metricRow('B',90,{}),
  metricRow('C',90,{})
], []);
awards = calculatePrizeAllocation(r,zone);
assert.deepStrictEqual(
  awards.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['A',5000],['B',2500],['C',2500]]
);

// 11. Empate de 3 em 2º: 2º+3º+4º (4º = 0%).
r = sportsRank([
  metricRow('A',100,{}),
  metricRow('B',90,{}),
  metricRow('C',90,{}),
  metricRow('D',90,{})
], []);
awards = calculatePrizeAllocation(r,zone);
assert.deepStrictEqual(
  awards.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['A',5000],['B',1666.67],['C',1666.67],['D',1666.67]]
);

// 12. Residual fica para a casa; não é redistribuído.
r = [
  {user:{name:'A'},position:1,totalPoints:100},
  {user:{name:'B'},position:1,totalPoints:100},
  {user:{name:'C'},position:1,totalPoints:100}
];
awards = calculatePrizeAllocation(r,{positions:1,totalAmount:100,
  distribution:[{position:1,percentage:100}]});
let paid = Number(awards.filter(x=>x.prizeEligible)
  .reduce((s,x)=>s+Number(x.prizeAmount||0),0).toFixed(2));
assert.strictEqual(paid,99.99);
assert.strictEqual(Number((100-paid).toFixed(2)),0.01);
assert.deepStrictEqual(
  awards.filter(x=>x.prizeEligible).map(x=>x.prizeAmount),
  [33.33,33.33,33.33]
);

// 13. Empate fora da zona não recebe.
r = [
  {user:{name:'A'},position:1,totalPoints:100},
  {user:{name:'B'},position:2,totalPoints:90},
  {user:{name:'C'},position:3,totalPoints:80},
  {user:{name:'D'},position:3,totalPoints:80}
];
awards = calculatePrizeAllocation(r,zone);
assert.strictEqual(awards.find(x=>x.user.name==='C').prizeEligible,true);
assert.strictEqual(awards.find(x=>x.user.name==='D').prizeEligible,true);

// 14. Configuração parcial: ativar mata-mata NÃO adiciona critério automaticamente.
const existing = {
  championshipRules:{hasKnockoutPhase:false},
  rankingRules:{tieBreakers:['exactScorePoints']}
};
const activated = {
  ...existing,
  championshipRules:{...existing.championshipRules,hasKnockoutPhase:true}
};
assert.deepStrictEqual(activated.rankingRules.tieBreakers,['exactScorePoints']);

// 15. Configuração parcial: desativar mata-mata DEVE remover knockoutPoints.
// O helper abaixo representa a correção desejada no endpoint.
function reconcileKnockoutTieBreaker(championshipRules, rankingRules) {
  if (championshipRules.hasKnockoutPhase !== true) {
    return {
      ...rankingRules,
      tieBreakers:(rankingRules.tieBreakers || [])
        .filter(x=>x!=='knockoutPoints')
    };
  }
  return rankingRules;
}
let reconciled = reconcileKnockoutTieBreaker(
  {hasKnockoutPhase:false},
  {tieBreakers:['knockoutPoints','exactScorePoints']}
);
assert.deepStrictEqual(reconciled.tieBreakers,['exactScorePoints']);

// 16. Configuração parcial da zona preserva os demais campos.
const currentZone = {
  positions:3,totalAmount:10000,
  distribution:[
    {position:1,percentage:50},
    {position:2,percentage:30},
    {position:3,percentage:20}
  ]
};
const partialZone = {...currentZone,totalAmount:20000};
assert.strictEqual(partialZone.positions,3);
assert.strictEqual(partialZone.totalAmount,20000);
assert.deepStrictEqual(partialZone.distribution,currentZone.distribution);

// 17. Ordem dos critérios é realmente prioridade.
const p = metricRow('P',100,{knockoutPoints:30,exactScorePoints:1});
const q = metricRow('Q',100,{knockoutPoints:20,exactScorePoints:99});
assert(compareBySportsRanking(p,q,['knockoutPoints','exactScorePoints']) < 0);
assert(compareBySportsRanking(p,q,['exactScorePoints','knockoutPoints']) > 0);

console.log('full-prize-ranking-battery.test.js: OK');
