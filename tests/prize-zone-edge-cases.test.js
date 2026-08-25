'use strict';

const assert = require('assert');
const {
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
} = require('../services/rankingService');

function rank(items, tieBreakers = ['knockoutPoints']) {
  items.forEach(item => {
    item.__rankingTieKey = JSON.stringify(
      tieBreakers.map(k => Number(item.tieBreakerMetrics?.[k] || 0))
    );
  });
  items.sort((a,b) => {
    const r = compareBySportsRanking(a,b,tieBreakers);
    return r !== 0 ? r : String(a.user.name).localeCompare(String(b.user.name), 'pt-BR');
  });
  return assignSportsPositions(items);
}

const prizeZone = {
  positions: 3,
  totalAmount: 10000,
  distribution: [
    { position: 1, percentage: 50 },
    { position: 2, percentage: 30 },
    { position: 3, percentage: 20 }
  ]
};

// 1) Empate em 1º: 1º + 2º são somados e divididos.
let r = rank([
  { user:{name:'João'}, totalPoints:100, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Maria'}, totalPoints:100, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Pedro'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:5} }
]);
let a = calculatePrizeAllocation(r, prizeZone);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['João',1],['Maria',1],['Pedro',3]]);
assert.deepStrictEqual(
  a.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['João',4000],['Maria',4000],['Pedro',2000]]
);

// 2) Empate em 2º: 2º + 3º são somados e divididos.
r = rank([
  { user:{name:'João'}, totalPoints:100, tieBreakerMetrics:{knockoutPoints:20} },
  { user:{name:'Maria'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Pedro'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:10} }
]);
a = calculatePrizeAllocation(r, prizeZone);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['João',1],['Maria',2],['Pedro',2]]);
assert.deepStrictEqual(
  a.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['João',5000],['Maria',2500],['Pedro',2500]]
);

// 3) Empate em 3º dentro da última posição: divide apenas o prêmio de 3º.
r = rank([
  { user:{name:'João'}, totalPoints:100, tieBreakerMetrics:{knockoutPoints:30} },
  { user:{name:'Maria'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:20} },
  { user:{name:'Pedro'}, totalPoints:80, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Ana'}, totalPoints:80, tieBreakerMetrics:{knockoutPoints:10} }
]);
a = calculatePrizeAllocation(r, prizeZone);
assert.deepStrictEqual(r.map(x=>[x.user.name,x.position]), [['João',1],['Maria',2],['Ana',3],['Pedro',3]]);
assert.deepStrictEqual(
  a.filter(x=>x.prizeEligible).map(x=>[x.user.name,x.prizeAmount]),
  [['João',5000],['Maria',3000],['Ana',1000],['Pedro',1000]]
);

// 4) Três empatados em 2º: ocupam 2º,3º,4º.
// Como a zona termina em 3º, o algoritmo atual ainda deve considerar o grupo
// se sua posição inicial estiver dentro da zona; o valor precisa ser validado
// contra a regra definida. Este teste expõe o comportamento atual.
r = rank([
  { user:{name:'João'}, totalPoints:100, tieBreakerMetrics:{knockoutPoints:30} },
  { user:{name:'Ana'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Bruno'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Carlos'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:10} }
]);
a = calculatePrizeAllocation(r, prizeZone);
console.log('Caso 4 posições:', r.map(x=>[x.user.name,x.position]));
console.log('Caso 4 prêmios:', a.map(x=>[x.user.name,x.position,x.prizeEligible,x.prizeAmount]));

// 5) Empate definitivo fora da zona não deve receber prêmio.
r = rank([
  { user:{name:'João'}, totalPoints:100, tieBreakerMetrics:{knockoutPoints:30} },
  { user:{name:'Ana'}, totalPoints:90, tieBreakerMetrics:{knockoutPoints:20} },
  { user:{name:'Bruno'}, totalPoints:80, tieBreakerMetrics:{knockoutPoints:10} },
  { user:{name:'Carlos'}, totalPoints:70, tieBreakerMetrics:{knockoutPoints:5} },
  { user:{name:'Diego'}, totalPoints:70, tieBreakerMetrics:{knockoutPoints:5} }
]);
a = calculatePrizeAllocation(r, prizeZone);
assert.strictEqual(a.find(x=>x.user.name==='Carlos').prizeEligible, false);
assert.strictEqual(a.find(x=>x.user.name==='Diego').prizeEligible, false);

console.log('prize-zone-edge-cases.test.js: OK');
