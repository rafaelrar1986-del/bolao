
const assert = require('assert');
const allowed = new Set(['positionCorrect','positionIncorrect','teamQualified','teamNotQualified']);
const rules=[
 {points:3,conditions:['positionCorrect','teamQualified']},
 {points:2,conditions:['positionIncorrect','teamQualified']},
 {points:1,conditions:['positionCorrect','teamNotQualified']}
];
const signatures=new Set();
for(const r of rules){
 assert(Number.isFinite(Number(r.points)) && Number(r.points)>=0);
 assert(Array.isArray(r.conditions) && r.conditions.length>0);
 r.conditions.forEach(c=>assert(allowed.has(c)));
 const sig=[...new Set(r.conditions)].sort().join('|');
 assert(!signatures.has(sig)); signatures.add(sig);
}
console.log('group-qualification-rules-config.test.js: OK');
