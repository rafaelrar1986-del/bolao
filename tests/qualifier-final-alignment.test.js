const test=require('node:test'); const assert=require('node:assert/strict');
const score=(phase,match,extra,hit)=>match+(phase==='knockout'&&hit?extra:0);
test('grupo nunca recebe classificado',()=>assert.equal(score('group',5,3,true),5));
test('mata-mata soma classificado à partida',()=>assert.equal(score('knockout',5,3,true),8));
test('classificado pode pontuar independentemente da matchRule',()=>assert.equal(score('knockout',0,3,true),3));
test('classificado errado vale zero',()=>assert.equal(score('knockout',5,3,false),5));
