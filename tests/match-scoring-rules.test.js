'use strict';

const assert = require('assert');

function evaluateCondition(condition, bet, real) {
  const a = Number(bet.scoreA);
  const b = Number(bet.scoreB);
  const ra = Number(real.scoreA);
  const rb = Number(real.scoreB);
  const winner = ra > rb ? 'A' : rb > ra ? 'B' : 'draw';
  const betWinner = a > b ? 'A' : b > a ? 'B' : 'draw';

  switch (condition) {
    case 'exactScore': return a === ra && b === rb;
    case 'result': return betWinner === winner;
    case 'scoreTeamA': return a === ra;
    case 'scoreTeamB': return b === rb;
    case 'scoreWinner':
      return winner !== 'draw' &&
        (winner === 'A' ? a === ra : b === rb);
    case 'scoreLoser':
      return winner !== 'draw' &&
        (winner === 'A' ? b === rb : a === ra);
    case 'totalGoals': return a + b === ra + rb;
    case 'goalDifference': return Math.abs(a - b) === Math.abs(ra - rb);
    default: return false;
  }
}

function calculate(rules, bet, real) {
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].conditions.every(c => evaluateCondition(c, bet, real))) {
      return { points: rules[i].points, rule: i };
    }
  }
  return { points: 0, rule: null };
}

// 3x1 acertado: regra 1 vence e impede soma das regras seguintes.
let result = calculate([
  { points: 10, conditions: ['exactScore'] },
  { points: 6, conditions: ['result', 'scoreWinner'] },
  { points: 2, conditions: ['result'] }
], {scoreA:3,scoreB:1}, {scoreA:3,scoreB:1});
assert.deepStrictEqual(result, {points:10,rule:0});

// 4x2: não é exato, mas vencedor + gols do vencedor.
result = calculate([
  { points: 10, conditions: ['exactScore'] },
  { points: 6, conditions: ['result', 'scoreWinner'] },
  { points: 2, conditions: ['result'] }
], {scoreA:3,scoreB:2}, {scoreA:3,scoreB:1});
assert.deepStrictEqual(result, {points:6,rule:1});

// Gols do perdedor é independente do resultado previsto:
// real 3x1, palpite 4x1 -> perdedor real marcou 1 e a condição é satisfeita.
result = calculate([
  { points: 4, conditions: ['scoreLoser'] },
  { points: 2, conditions: ['result'] }
], {scoreA:0,scoreB:1}, {scoreA:3,scoreB:1});
assert.deepStrictEqual(result, {points:4,rule:0});

// Gols do vencedor também é independente do resultado previsto:
// real 3x1, palpite 0x3 -> vencedor real marcou 3, então a condição é satisfeita.
result = calculate([
  { points: 4, conditions: ['scoreWinner'] }
], {scoreA:3,scoreB:4}, {scoreA:3,scoreB:1});
assert.deepStrictEqual(result, {points:4,rule:0});

// Quando o administrador combina com Resultado, o E continua exigindo ambos.
result = calculate([
  { points: 6, conditions: ['result', 'scoreWinner'] }
], {scoreA:3,scoreB:4}, {scoreA:3,scoreB:1});
assert.deepStrictEqual(result, {points:0,rule:null});

// Empate: gols do vencedor/perdedor não podem ser satisfeitos.
result = calculate([
  { points: 6, conditions: ['result', 'scoreWinner'] },
  { points: 2, conditions: ['result'] }
], {scoreA:2,scoreB:2}, {scoreA:1,scoreB:1});
assert.deepStrictEqual(result, {points:2,rule:1});

console.log('match-scoring-rules.test.js: OK');

// Total de gols e diferença de gols são condições próprias.
result = calculate([
  { points: 3, conditions: ['totalGoals'] }
], {scoreA:2,scoreB:2}, {scoreA:3,scoreB:1});
assert.deepStrictEqual(result, {points:3,rule:0});

result = calculate([
  { points: 4, conditions: ['goalDifference'] }
], {scoreA:4,scoreB:1}, {scoreA:3,scoreB:0});
assert.deepStrictEqual(result, {points:4,rule:0});
