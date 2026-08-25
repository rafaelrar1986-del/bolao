
'use strict';

const assert = require('assert');
const { calculateGroupStandings } = require('../services/groupStandingsService');

// 4 teams. A and B finish with the same total points.
// A beats B directly, so A must rank above B regardless of general GD.
const matches = [
  { group:'A', teamA:'A', teamB:'B', scoreA:1, scoreB:0 },
  { group:'A', teamA:'A', teamB:'C', scoreA:0, scoreB:1 },
  { group:'A', teamA:'A', teamB:'D', scoreA:3, scoreB:0 },

  { group:'A', teamA:'B', teamB:'C', scoreA:2, scoreB:0 },
  { group:'A', teamA:'B', teamB:'D', scoreA:1, scoreB:0 },

  { group:'A', teamA:'C', teamB:'D', scoreA:0, scoreB:1 }
];

const result = calculateGroupStandings(matches)['A'];
assert.deepStrictEqual(result.map(x => x.name), ['A','B','D','C']);
assert.strictEqual(result[0].pts, result[1].pts);

// Also verify that missing scores do not invent a result.
const partial = calculateGroupStandings([
  { group:'A', teamA:'A', teamB:'B', scoreA:2, scoreB:1 },
  { group:'A', teamA:'A', teamB:'C', scoreA:null, scoreB:null }
])['A'];

assert.strictEqual(partial.find(x=>x.name==='A').pj, 1);
assert.strictEqual(partial.find(x=>x.name==='C').pj, 0);

console.log('group-standings-source-of-truth.test.js: OK');
