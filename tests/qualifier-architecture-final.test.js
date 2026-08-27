const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const root=path.resolve(__dirname,'..','..'); const read=r=>fs.readFileSync(path.join(root,r),'utf8');

test('Admin conditionOptions não contém qualifier',()=>{
 const s=read('frontend/js/admin.js'); const m=s.match(/const conditionOptions = \[[\s\S]*?\];/); assert.ok(m); assert.doesNotMatch(m[0],/qualifier/);
});
test('Admin usa matchExtras.qualifier',()=>assert.match(read('frontend/js/admin.js'),/matchExtras:\s*\{[\s\S]*?qualifier:/));
test('API não aceita qualifier na lista de matchRules',()=>{
 const s=read('backend/routes/settings.js'); const m=s.match(/const allowedConditions = \[[\s\S]*?\];/); assert.ok(m); assert.doesNotMatch(m[0],/qualifier/); assert.match(s,/condition === ['"]qualifier['"]/);
});
test('Schema usa matchExtras.qualifier e não scoringRules.qualifier',()=>{
 const s=read('backend/models/Settings.js'); assert.match(s,/matchExtras:\s*\{[\s\S]*?qualifier:/); assert.doesNotMatch(s,/^\s*qualifier:\s*\{ type: Number, default: 3 \},/m);
});
test('pointsService não avalia qualifier como condição',()=>assert.doesNotMatch(read('backend/services/pointsService.js'),/case ['"]qualifier['"]/));
