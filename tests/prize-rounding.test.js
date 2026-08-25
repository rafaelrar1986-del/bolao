'use strict';

const assert = require('assert');
const { calculatePrizeAllocation } = require('../services/rankingService');

function users(n, position=1) {
  return Array.from({length:n}, (_,i)=>({
    user:{name:`U${i+1}`},
    position,
    totalPoints:100
  }));
}

// 1) Divisão exata.
let r = calculatePrizeAllocation(users(2), {
  positions:1, totalAmount:100,
  distribution:[{position:1,percentage:100}]
});
assert.deepStrictEqual(r.map(x=>x.prizeAmount), [50,50]);

// 2) Divisão com dízima: 100 / 3.
// O valor individual é arredondado para centavos.
r = calculatePrizeAllocation(users(3), {
  positions:1, totalAmount:100,
  distribution:[{position:1,percentage:100}]
});
console.log('100/3:', r.map(x=>x.prizeAmount), 'total:', r.reduce((s,x)=>s+x.prizeAmount,0));

// 3) Empate em 2º: soma 2º+3º, depois divide.
r = calculatePrizeAllocation([
  {user:{name:'A'},position:1,totalPoints:100},
  {user:{name:'B'},position:2,totalPoints:90},
  {user:{name:'C'},position:2,totalPoints:90}
], {
  positions:3,totalAmount:100,
  distribution:[
    {position:1,percentage:50},
    {position:2,percentage:30},
    {position:3,percentage:20}
  ]
});
assert.deepStrictEqual(
  r.filter(x=>x.prizeEligible).map(x=>x.prizeAmount),
  [50,25,25]
);

// 4) Empate de 3 em 2º: 30% + 20% + 0%, dividido por 3.
r = calculatePrizeAllocation([
  {user:{name:'A'},position:1,totalPoints:100},
  {user:{name:'B'},position:2,totalPoints:90},
  {user:{name:'C'},position:2,totalPoints:90},
  {user:{name:'D'},position:2,totalPoints:90}
], {
  positions:3,totalAmount:10000,
  distribution:[
    {position:1,percentage:50},
    {position:2,percentage:30},
    {position:3,percentage:20}
  ]
});
assert.deepStrictEqual(
  r.filter(x=>x.prizeEligible).map(x=>x.prizeAmount),
  [5000,1666.67,1666.67,1666.67]
);

// 5) Verifica se o arredondamento individual pode gerar diferença no total.
r = calculatePrizeAllocation(users(3), {
  positions:1,totalAmount:100,
  distribution:[{position:1,percentage:100}]
});
const total = Number(r.reduce((s,x)=>s+Number(x.prizeAmount||0),0).toFixed(2));
console.log('diferença residual:', Number((100-total).toFixed(2)));

// Não falha: este teste registra o comportamento atual para decidirmos se
// precisamos de uma regra de distribuição do centavo residual.
console.log('prize-rounding.test.js: OK');
