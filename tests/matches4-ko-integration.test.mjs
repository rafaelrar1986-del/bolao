import assert from 'node:assert/strict';
globalThis.window={addEventListener(){},STATE:null};
globalThis.document={addEventListener(){},querySelectorAll(){return[]},querySelector(){return null},getElementById(){return null},createElement(){return {style:{},classList:{add(){},remove(){}},setAttribute(){},appendChild(){},querySelector(){return null}}}};
globalThis.localStorage={getItem(k){return k==='selectedLeagueId'?'1':null},setItem(){},removeItem(){}};
globalThis.requestAnimationFrame=f=>f();globalThis.getComputedStyle=()=>({position:'static'});
const m=await import(new URL('../js/matches4.js',import.meta.url));
window.STATE.matches=[
 {matchId:10,phase:'knockout',group:'Oitavas',status:'scheduled',teamA:'A',teamB:'B'},
 {matchId:11,phase:'knockout',group:'Oitavas',status:'scheduled',teamA:'C',teamB:'D'}
];
window.STATE.scoringRules={winner:1,exactScore:0,scoreTeamA:0,scoreTeamB:0,matchExtras:{qualifier:3}};
window.STATE.championshipRules={knockoutFormat:'single'};
window.STATE.betsMap=new Map([[10,'A']]);
window.STATE.knockoutQualifiers=new Map([[10,'A']]);
assert.equal(m.getMissingKnockoutDecisionsCount(),2);
assert.equal(m.getMissingKnockoutQualifiers().length,1);
console.log('MATCHES4_KO_INTEGRATION_OK');
