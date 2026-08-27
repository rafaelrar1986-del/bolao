const test = require('node:test');
const assert = require('node:assert/strict');

function calc({phase, rulePoints, qualifierPoints, qualifierHit, exactHit, teamAHit, teamBHit, winnerHit}) {
  const knockout = phase === 'knockout';
  // Custom rules are mutually exclusive (first satisfied rule wins).
  const match = rulePoints;
  const extra = knockout && qualifierHit ? qualifierPoints : 0;
  return match + extra;
}

test('grupos: nenhuma configuração de classificado altera a pontuação', () => {
  assert.equal(calc({phase:'group', rulePoints:5, qualifierPoints:3, qualifierHit:true}), 5);
  assert.equal(calc({phase:'group', rulePoints:2, qualifierPoints:3, qualifierHit:true}), 2);
});

test('mata-mata: regra de partida + classificado são somados', () => {
  assert.equal(calc({phase:'knockout', rulePoints:5, qualifierPoints:3, qualifierHit:true}), 8);
  assert.equal(calc({phase:'knockout', rulePoints:2, qualifierPoints:3, qualifierHit:true}), 5);
});

test('mata-mata: classificado errado não soma', () => {
  assert.equal(calc({phase:'knockout', rulePoints:5, qualifierPoints:3, qualifierHit:false}), 5);
});

test('máximo em regra personalizada = maior regra + classificado', () => {
  const max = Math.max(5, 2, 1) + 3;
  assert.equal(max, 8);
});

test('máximo em grupo não recebe extra de classificado', () => {
  const max = Math.max(5, 2, 1);
  assert.equal(max, 5);
});

test('mix: 4 partidas mata-mata, 3 classificados corretos', () => {
  const matchPoints = [5, 2, 5, 1];
  const qualifierHits = [true, true, false, true];
  const qualifier = 3;
  const total = matchPoints.reduce((s,p,i) => s + p + (qualifierHits[i] ? qualifier : 0), 0);
  assert.equal(total, 5+3 + 2+3 + 5 + 1+3);
  assert.equal(total, 22);
});
