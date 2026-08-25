'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'services', 'dailyHistoryService.js');
const source = fs.readFileSync(file, 'utf8');

// Regression 1: rankedSnapshots must be created from snapshots itself.
// The previous code referenced positionedSnapshots before its declaration,
// producing: ReferenceError: Cannot access 'positionedSnapshots' before initialization.
assert.match(
  source,
  /const rankedSnapshots = snapshots\.map\(snapshot => \(\{/,
  'rankedSnapshots deve partir de snapshots'
);
assert.doesNotMatch(
  source,
  /const rankedSnapshots = positionedSnapshots\.map\(snapshot => \(\{/,
  'rankedSnapshots não pode depender de positionedSnapshots antes da declaração'
);

// Regression 2: the persisted daily position must come from the positioned array.
assert.match(
  source,
  /await PointsHistory\.bulkWrite\(\s*positionedSnapshots\.map\(snapshot => \(\{/s,
  'bulkWrite deve persistir os snapshots já posicionados'
);

// Regression 3: the ranking pipeline must still use the configured tie-breakers.
assert.match(source, /normalizeTieBreakers\(/);
assert.match(source, /compareBySportsRanking\(a, b, tieBreakers\)/);
assert.match(source, /assignSportsPositions\(rankedSnapshots\)/);

console.log('daily-history-unfinish-regression.test.js: OK');
