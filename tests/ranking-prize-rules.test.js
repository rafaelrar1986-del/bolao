
const assert = require('assert');
const {
  normalizeTieBreakers,
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
} = require('../services/rankingService');

function rank(items, settings) {
  const tb = normalizeTieBreakers(settings.rankingRules.tieBreakers, settings);
  const copy = items.map(x => ({
    ...x,
    __rankingTieKey: JSON.stringify(tb.map(k => Number(x.tieBreakerMetrics?.[k] || 0)))
  }));
  copy.sort((a,b) => compareBySportsRanking(a,b,tb));
  return assignSportsPositions(copy);
}

const baseSettings = {
  championshipRules: { hasKnockoutPhase: true },
  rankingRules: { tieBreakers: [] }
};

// 0 critérios: empate esportivo permanece empate.
let r=rank([
 {id:'A',totalPoints:100,tieBreakerMetrics:{}},
 {id:'B',totalPoints:100,tieBreakerMetrics:{}},
 {id:'C',totalPoints:90,tieBreakerMetrics:{}}
],baseSettings);
assert.deepStrictEqual(r.map(x=>[x.id,x.position]),[['A',1],['B',1],['C',3]]);

// 1 critério: placar exato desempata.
r=rank([
 {id:'A',totalPoints:100,tieBreakerMetrics:{exactScorePoints:20}},
 {id:'B',totalPoints:100,tieBreakerMetrics:{exactScorePoints:15}},
 {id:'C',totalPoints:90,tieBreakerMetrics:{exactScorePoints:30}}
],{...baseSettings,rankingRules:{tieBreakers:['exactScorePoints']}});
assert.deepStrictEqual(r.map(x=>[x.id,x.position]),[['A',1],['B',2],['C',3]]);

// Hierarquia: primeiro empate, segundo resolve.
r=rank([
 {id:'A',totalPoints:100,tieBreakerMetrics:{exactScorePoints:20,podiumPoints:5}},
 {id:'B',totalPoints:100,tieBreakerMetrics:{exactScorePoints:20,podiumPoints:7}},
 {id:'C',totalPoints:100,tieBreakerMetrics:{exactScorePoints:19,podiumPoints:99}}
],{...baseSettings,rankingRules:{tieBreakers:['exactScorePoints','podiumPoints']}});
assert.deepStrictEqual(r.map(x=>[x.id,x.position]),[['B',1],['A',2],['C',3]]);

// Mata-mata só fica disponível se hasKnockoutPhase=true.
assert.deepStrictEqual(
 normalizeTieBreakers(['knockoutPoints'],{championshipRules:{hasKnockoutPhase:false}}),
 []
);
assert.deepStrictEqual(
 normalizeTieBreakers(['knockoutPoints'],{championshipRules:{hasKnockoutPhase:true}}),
 ['knockoutPoints']
);

// Não repete e limita a 3.
assert.deepStrictEqual(
 normalizeTieBreakers(
   ['exactScorePoints','exactScorePoints','podiumPoints','extraPoints'],
   {championshipRules:{hasKnockoutPhase:true}}
 ),
 ['exactScorePoints','podiumPoints','extraPoints']
);

// Zona de premiação: empate em 1º divide 1º+2º.
r=rank([
 {id:'A',totalPoints:100,tieBreakerMetrics:{}},
 {id:'B',totalPoints:100,tieBreakerMetrics:{}},
 {id:'C',totalPoints:90,tieBreakerMetrics:{}},
 {id:'D',totalPoints:80,tieBreakerMetrics:{}}
],baseSettings);
let p=calculatePrizeAllocation(r,{
 positions:3,totalAmount:10000,
 distribution:[
   {position:1,percentage:40},
   {position:2,percentage:35},
   {position:3,percentage:25}
 ]
});
assert.strictEqual(p.find(x=>x.id==='A').prizeAmount,3750);
assert.strictEqual(p.find(x=>x.id==='B').prizeAmount,3750);
assert.strictEqual(p.find(x=>x.id==='C').prizeAmount,2500);

console.log('ranking-prize-rules.test.js: OK');
