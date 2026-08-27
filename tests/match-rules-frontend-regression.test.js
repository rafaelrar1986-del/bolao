'use strict';
const assert = require('assert');

function winner(a,b){ return a>b?'A':b>a?'B':'draw'; }
function cond(c, bet, ref) {
  const bw=winner(bet.a,bet.b);
  switch(c){
    case 'exactScore': return bet.a===ref.a && bet.b===ref.b;
    case 'result': return bw===winner(ref.a,ref.b);
    case 'scoreTeamA': return bet.a===ref.a;
    case 'scoreTeamB': return bet.b===ref.b;
    case 'scoreWinner': {
      const rw=winner(ref.a,ref.b);
      return (rw==='A'||rw==='B') && (rw==='A'?bet.a:bet.b)===(rw==='A'?ref.a:ref.b);
    }
    case 'scoreLoser': {
      const rw=winner(ref.a,ref.b);
      return (rw==='A'||rw==='B') && (rw==='A'?bet.b:bet.a)===(rw==='A'?ref.b:ref.a);
    }
    case 'totalGoals': return bet.a+bet.b===ref.a+ref.b;
    case 'goalDifference': return Math.abs(bet.a-bet.b)===Math.abs(ref.a-ref.b);
    default: return false;
  }
}
function calc(rules,bet,ref){
  for(let i=0;i<rules.length;i++){
    if(rules[i].conditions.every(c=>cond(c,bet,ref))) return {points:rules[i].points,index:i};
  }
  return {points:0,index:null};
}

const rules=[
 {points:10,conditions:['exactScore']},
 {points:6,conditions:['result','scoreWinner']},
 {points:4,conditions:['result','scoreLoser']},
 {points:2,conditions:['result']}
];

assert.deepStrictEqual(calc(rules,{a:3,b:1},{a:3,b:1}),{points:10,index:0});
assert.deepStrictEqual(calc(rules,{a:3,b:2},{a:3,b:1}),{points:6,index:1});
assert.deepStrictEqual(calc(rules,{a:2,b:1},{a:3,b:1}),{points:4,index:2});
assert.deepStrictEqual(calc(rules,{a:2,b:0},{a:3,b:1}),{points:2,index:3});
// Independência: vencedor real marcou 3, mesmo com vencedor previsto errado.
assert.deepStrictEqual(calc(
  [{points:4,conditions:['scoreWinner']}],
  {a:3,b:4},{a:3,b:1}
),{points:4,index:0});

// Independência: perdedor real marcou 1, mesmo com vencedor previsto errado.
assert.deepStrictEqual(calc(
  [{points:4,conditions:['scoreLoser']}],
  {a:0,b:1},{a:3,b:1}
),{points:4,index:0});

// E continua sendo E: resultado errado impede a regra combinada.
assert.deepStrictEqual(calc(
  [{points:6,conditions:['result','scoreWinner']}],
  {a:3,b:4},{a:3,b:1}
),{points:0,index:null});

console.log('match-rules-frontend-regression.test.js: OK');
