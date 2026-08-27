const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const root=path.resolve(__dirname,'..','..');
const read=r=>fs.readFileSync(path.join(root,r),'utf8');
for (const rel of ['backend/models/Settings.js','backend/services/pointsService.js','backend/routes/settings.js','frontend/js/admin.js','frontend/js/frontendScoring.js','frontend/js/matches4.js']) {
 test(`${rel} não usa scoringMode`,()=>assert.doesNotMatch(read(rel),/scoringMode|\.scoringMode/));
}
