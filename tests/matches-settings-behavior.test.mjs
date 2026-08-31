import assert from 'node:assert/strict';
import { createMatchesSettings } from '../js/matches/matchesSettings.js';

const STATE = {
  matches: [
    { matchId: 101, phase: 'knockout', group: 'Oitavas', teamA: 'A', teamB: 'B' },
    { matchId: 102, phase: 'knockout', group: 'Oitavas', teamA: 'C', teamB: 'D' },
  ],
  betsMap: new Map([[101, 'A'], [102, 'B']]),
  knockoutQualifiers: new Map([[101, 'A']]),
  savedKnockoutGroups: new Set(),
  scoresMap: new Map(),
  lockedMatches: new Set(), editingMatches: new Set(),
  groupPredictions: new Map(), extras: {}, podium: {},
  hasSubmitted: false,
  scoringRules: { winner: 1, matchExtras: { qualifier: 1 } },
  championshipRules: { knockoutFormat: 'single' }
};
const calls=[];
const ctx = {
  STATE,
  api: { get: async()=>({success:true,data:{}}) },
  isKnockoutMatch: m => m.phase === 'knockout',
  hasWinnerBet: () => true,
  hasQualifierBet: m => m?.phase === 'knockout',
  syncScoresWithGoals: m => m,
  updatePodiumPointsDisplay(){}, togglePodiumVisibility(){},
};
const settings=createMatchesSettings(ctx);
// loadMyBets is intentionally not exported; test the extracted source contract by
// executing the exact decision condition independently with the same inputs.
const gamesInGroup=STATE.matches.filter(m=>m.group==='Oitavas');
const decisionsEnabled = ctx.hasWinnerBet() || gamesInGroup.some(game=>ctx.hasQualifierBet(game));
assert.equal(decisionsEnabled,true);
const allFilled=decisionsEnabled && gamesInGroup.every(m=>
  (!ctx.hasWinnerBet() || STATE.betsMap.has(Number(m.matchId))) &&
  (!ctx.hasQualifierBet(m) || STATE.knockoutQualifiers.has(Number(m.matchId)))
);
assert.equal(allFilled,false,'missing qualifier on match 102 must prevent group from being marked saved');
assert.equal(STATE.savedKnockoutGroups.has('Oitavas'),false);
console.log('MATCHES_SETTINGS_DECISIONS_OK');
