const test=require('node:test'); const assert=require('node:assert/strict');

function calc({knockout, ruleHit, rulePoints=0, qualifierHit, qualifierPoints=0}) {
  return (ruleHit ? rulePoints : 0) + (knockout && qualifierHit ? qualifierPoints : 0);
}
function max({knockout, maxRule=0, qualifierPoints=0}) {
  return maxRule + (knockout ? qualifierPoints : 0);
}

test('grupo: classificado nunca pontua',()=>assert.equal(calc({knockout:false,ruleHit:true,rulePoints:5,qualifierHit:true,qualifierPoints:3}),5));
test('mata-mata: regra + classificado somam',()=>assert.equal(calc({knockout:true,ruleHit:true,rulePoints:5,qualifierHit:true,qualifierPoints:3}),8));
test('mata-mata: classificado é independente da regra',()=>assert.equal(calc({knockout:true,ruleHit:false,rulePoints:5,qualifierHit:true,qualifierPoints:3}),3));
test('mata-mata: regra acertada e classificado errado',()=>assert.equal(calc({knockout:true,ruleHit:true,rulePoints:5,qualifierHit:false,qualifierPoints:3}),5));
test('máximo grupo não inclui classificado',()=>assert.equal(max({knockout:false,maxRule:5,qualifierPoints:3}),5));
test('máximo mata-mata inclui classificado',()=>assert.equal(max({knockout:true,maxRule:5,qualifierPoints:3}),8));
