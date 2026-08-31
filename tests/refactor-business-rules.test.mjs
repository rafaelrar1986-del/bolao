import assert from 'node:assert/strict';
import { createMatchesRules } from '../js/matches/matchesRules.js';
import { createMatchesScoring } from '../js/matches/matchesScoring.js';
import { createMatchesBetting } from '../js/matches/matchesBetting.js';
import { createMatchesProgress } from '../js/matches/matchesProgress.js';
import { createKnockoutConfrontationHelpers } from '../js/matches/matchesConfrontation.js';
import { calculateMatchPoints, getMatchPointStatus, getEffectiveBetWinner } from '../js/frontendScoring.js';
import { isKnockoutMatch, parseMatchDate } from '../js/matches/matchesUtils.js';

const STATE={
  matches:[
    {matchId:1,phase:'group',group:'A',status:'scheduled',teamA:'A',teamB:'B'},
    {matchId:2,phase:'knockout',group:'Oitavas',status:'scheduled',teamA:'C',teamB:'D'},
    {matchId:3,phase:'knockout',group:'Oitavas',status:'scheduled',teamA:'D',teamB:'C'},
  ],
  betsMap:new Map([[1,'A'],[2,'B']]),
  scoresMap:new Map([[1,{scoreA:2,scoreB:1}]]),
  knockoutQualifiers:new Map([[2,'B']]),
  lockedMatches:new Set(),editingMatches:new Set(),savedKnockoutGroups:new Set(),
  groupBetAvailabilityMode:'all',pointsRunBetAvailabilityMode:'all',knockoutBetAvailabilityMode:'all',
  unlockedGroupRounds:new Set(),lockedGroupRounds:new Set(),unlockedPointsRunRounds:new Set(),lockedPointsRunRounds:new Set(),unlockedKnockoutRounds:new Set(),lockedKnockoutRounds:new Set(),
  testMode:false,lockedPhases:new Set(),unlockedPhases:new Set(),hasSubmitted:false,
  scoringRules:{exactScore:5,scoreTeamA:1,scoreTeamB:1,winner:2,matchExtras:{qualifier:3},podiumPoints:[20,15,10,5],topScorer:10,bestAttack:10,worstDefense:10,upset:15},
  championshipRules:{podiumSize:4,winnerFromScore:true,drawIncludesExtraTime:false,knockoutFormat:'single'},
  podium:{first:'Brazil',second:'',third:'',fourth:''},extras:{topScorer:'',bestAttack:'',worstDefense:'',upset:''}
};
const ctx={STATE,isKnockoutMatch,parseMatchDate, getFrontendMatchPointStatus:getMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints:calculateMatchPoints};
Object.assign(ctx,createKnockoutConfrontationHelpers({STATE,getChampionshipRules:()=>STATE.championshipRules,calculateScoringMatchPoints:calculateMatchPoints,getFrontendMatchPointStatus:getMatchPointStatus}));
Object.assign(ctx,createMatchesRules(ctx));
Object.assign(ctx,createMatchesScoring(ctx));
Object.assign(ctx,createMatchesBetting(ctx));
Object.assign(ctx,createMatchesProgress(ctx));

assert.equal(ctx.hasWinnerBet(),true);
assert.equal(ctx.hasScoreInput(),true);
assert.equal(ctx.getDisplayWinner('B',{scoreA:2,scoreB:1}),'A','winnerFromScore must derive winner from predicted score');
assert.equal(ctx.getDisplayWinner('draw',{scoreA:2,scoreB:1}),'A');
assert.equal(ctx.getMissingGroupBets().length,0);
assert.equal(ctx.getMissingExtrasBets().length,4);
assert.deepEqual(ctx.getMissingPodiumBets(),['second','third','fourth']);
assert.equal(ctx.getMissingRequiredBetsTotal().total,7);
assert.equal(ctx.getMissingKnockoutDecisionsCount(),2,'KO must count missing winner+qualifier on match 3 only');

// Home/away qualifier path must resolve through the confrontation helpers without ReferenceError.
STATE.championshipRules.knockoutFormat='home_away';
STATE.matches[1]={...STATE.matches[1],status:'finished',scoreA:1,scoreB:0,regularTimeScoreA:1,regularTimeScoreB:0};
STATE.matches[2]={...STATE.matches[2],status:'finished',scoreA:1,scoreB:0,regularTimeScoreA:1,regularTimeScoreB:0};
assert.equal(ctx.getMatchRefQualifier(STATE.matches[1]),null,'aggregate tie without penalties must remain unresolved');

STATE.extras={topScorer:'X',bestAttack:'Y',worstDefense:'Z',upset:'W'};
STATE.podium={first:'Brazil',second:'A',third:'B',fourth:'C'};
assert.equal(ctx.getMissingRequiredBetsTotal().total,0);

// Availability/lock rules.
const started={...STATE.matches[0],status:'1_tempo'};
assert.equal(ctx.isMatchEditable(started),false);
STATE.testMode=true;
assert.equal(ctx.isMatchEditable(started),false,'testMode must not bypass a started match lock');
console.log('MATCHES_BUSINESS_RULES_OK');

STATE.testMode = true;
STATE.betLockMode = 'grade';
STATE.groupBetAvailabilityMode = 'round';
STATE.unlockedGroupRounds = new Set([1]);
STATE.lockedGroupRounds = new Set();
STATE.matches = [
  {matchId:10,phase:'group',group:'A',phaseName:'Grupo A',roundNumber:1,status:'scheduled',date:'02/09/2026',time:'12:00'},
  {matchId:11,phase:'group',group:'A',phaseName:'Grupo A',roundNumber:1,status:'in_progress',date:'02/09/2026',time:'11:00'}
];
assert.equal(ctx.isMatchEditable(STATE.matches[0], new Date('2026-09-02T11:30:00Z')), false, 'grade mode must lock the entire grade after first start');
console.log('GRADE_WIDE_TEST_OK');
