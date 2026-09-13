import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./matchesBetting.js', import.meta.url), 'utf8');

assert.match(source, /const isGroupPhase\s*=\s*phaseLower\s*===\s*['"]group['"]/);
assert.match(source, /if\s*\(\s*isGroupPhase\s*&&\s*STATE\.groupBetAvailabilityMode\s*===\s*['"]round['"]\s*\)/);
assert.match(source, /STATE\.unlockedGroupRounds\.has\(round\)/);
assert.match(source, /STATE\.lockedGroupRounds\.has\(round\)/);
assert.match(source, /!STATE\.testMode\s*&&\s*\(isMatchStartedByStatus\(match\)\s*\|\|\s*isMatchStartedByTime\(match\)\)/);
assert.match(source, /if\s*\(\s*!STATE\.testMode\s*\)/);

console.log('round availability regression checks passed');
