const assert = require('assert');
const { getBetLockState } = require('../services/betLockService');
const v = require('../services/betVisibilityService');
const now = new Date('2026-08-31T12:00:00Z');
const base = { phase:'group', group:'A', phaseName:'Grupo A', roundNumber:1, status:'scheduled', date:'01/09/2026', time:'23:00' };
function state(settings, match=base, admin=false, owner=false, allMatches=[]) {
  return v.getVisibilityLockState(match, settings, admin, getBetLockState, owner, now, allMatches);
}
function check(name, fn) { try { fn(); console.log('PASS', name); } catch(e) { console.log('FAIL', name, '-', e.message); process.exitCode=1; } }

check('rodada liberada permanece privada enquanto editavel', () => {
  const x=state({groupBetAvailabilityMode:'round',unlockedGroupRounds:[1],unlockedPhases:['Grupo A']});
  assert.equal(x.editable,true); assert.equal(x.visible,false); assert.equal(x.locked,true);
});
check('rodada nao liberada permanece privada', () => {
  const x=state({groupBetAvailabilityMode:'round',unlockedGroupRounds:[],unlockedPhases:[]});
  assert.equal(x.editable,false); assert.equal(x.visible,false); assert.equal(x.locked,true);
});
check('partida iniciada + fase liberada = publico', () => {
  const x=state({groupBetAvailabilityMode:'round',unlockedGroupRounds:[1],unlockedPhases:['Grupo A']}, {...base,status:'in_progress'});
  assert.equal(x.editable,false); assert.equal(x.visible,true); assert.equal(x.locked,false);
});
check('partida iniciada sem fase liberada = privado', () => {
  const x=state({groupBetAvailabilityMode:'all',unlockedPhases:[]}, {...base,status:'in_progress'});
  assert.equal(x.editable,false); assert.equal(x.visible,false); assert.equal(x.locked,true);
});
check('testMode finalizada sem fase liberada = privado', () => {
  const x=state({testMode:true,betLockMode:'grade',unlockedPhases:[]},{...base,status:'finished',date:'01/01/2020',time:'00:00'});
  assert.equal(x.editable,false); assert.equal(x.visible,false); assert.equal(x.locked,true);
});
check('blockSaveBets sozinho NAO libera visibilidade', () => {
  const x=state({blockSaveBets:true,unlockedPhases:[]});
  assert.equal(x.visible,false); assert.equal(x.locked,true);
});
check('blockSaveBets nao substitui o bloqueio por fase', () => {
  const x=state({blockSaveBets:true,unlockedPhases:['Grupo A']});
  assert.equal(x.visible,false);
});
check('admin = publico', () => assert.equal(state({unlockedPhases:[]},base,true,false).locked,false));
check('proprio usuario = publico', () => assert.equal(state({unlockedPhases:[]},base,false,true).locked,false));
check('mascara placar vencedor classificado', () => {
  const x=v.getVisibleBetData({matchId:1,winner:'A',scoreA:2,scoreB:1,qualifier:'A'},base,{locked:true,editable:true});
  assert.deepStrictEqual(x,{matchId:1,isLocked:true,isEditable:true,scoreA:null,scoreB:null,choice:'🔒',choiceLabel:'Bloqueado',qualifier:null});
});
check('podio e extras privados', () => { assert.deepStrictEqual(v.maskPodium(['A','B','C','D'],true),['🔒','🔒','🔒','🔒']); assert.deepStrictEqual(v.maskExtras({topScorer:'X',bestAttack:'Y'},true),{topScorer:'🔒',bestAttack:'🔒'}); });
check('groupPredictions privadas', () => { const x=v.maskGroupPredictions([{group:'A',positions:[{position:1,team:'X'}],additionalQualifiedTeams:['Y']}],true); assert.deepStrictEqual(x,[{group:'A',positions:[{position:1,team:'🔒'}],additionalQualifiedTeams:['🔒']}]); });
check('fail closed sem lock service', () => { const x=v.getVisibilityLockState(base,{},false,null,false,now); assert.equal(x.locked,true); assert.equal(x.visible,false); });

// Grade mode: the first started match locks every match in the same grade.
const gradeOpen = { matchId: 10, phase: 'group', phaseName: 'Grupo A', group: 'A', status: 'scheduled', date: '02/09/2026', time: '12:00' };
const gradeStarted = { matchId: 11, phase: 'group', phaseName: 'Grupo A', group: 'A', status: 'live', date: '02/09/2026', time: '11:00' };
const gradeOther = { matchId: 12, phase: 'group', phaseName: 'Grupo B', group: 'B', status: 'scheduled', date: '02/09/2026', time: '13:00' };
const gradeSettings = { betLockMode: 'grade', testMode: true, groupBetAvailabilityMode: 'all', lockedPhases: [], unlockedPhases: ['Grupo A'] };
assert.equal(getBetLockState(gradeOpen, gradeSettings, new Date('2026-09-02T11:30:00Z'), [gradeOpen, gradeStarted]).locked, true);
assert.equal(getBetLockState(gradeOther, gradeSettings, new Date('2026-09-02T11:30:00Z'), [gradeOpen, gradeStarted, gradeOther]).locked, false);
console.log('grade-wide test: PASS');
check('grade-wide visibility requires unlockedPhases', () => {
  const open = {...base, matchId:20, status:'scheduled', date:'02/09/2026', time:'12:00'};
  const started = {...base, matchId:21, status:'in_progress', date:'02/09/2026', time:'11:00'};
  const settings={testMode:true,betLockMode:'grade',groupBetAvailabilityMode:'all',lockedPhases:[],unlockedPhases:['Grupo A']};
  const x=v.getVisibilityLockState(open, settings, false, getBetLockState, false, new Date('2026-09-02T11:30:00Z'), [open,started]);
  assert.equal(x.editable,false); assert.equal(x.visible,true); assert.equal(x.locked,false);
});

console.log(process.exitCode ? 'PRIVACY_BATTERY_FAILED' : 'PRIVACY_BATTERY_PASSED');
