
const fs=require('fs'), path=require('path');
const s=fs.readFileSync(path.join(__dirname,'..','js','admin.js'),'utf8');
for(const token of ['positionCorrect','positionIncorrect','teamQualified','teamNotQualified','groupQualificationRules','btn-add-group-qualification-rule','gqr-rule-points']){
 if(!s.includes(token)) throw new Error('Token ausente: '+token);
}
console.log('group-qualification-rules-ui.test.js: OK');
