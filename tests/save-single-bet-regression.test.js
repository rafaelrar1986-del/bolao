const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'controllers', 'betSaveController.js');
const source = fs.readFileSync(file, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Regression: POST /api/bets/single in blockMode=grade must have the
// full league match list available to getBetLockState. Previously the
// controller referenced dbMatches without declaring it, causing HTTP 500.
assert(
  /const \[settings, dbMatches\] = await Promise\.all\(\[/.test(source),
  'dbMatches is not loaded alongside settings in saveSingleBet'
);
assert(
  /Match\.find\(\{ leagueId: configId \}\)[\s\S]*?\.select\('matchId group phase phaseName roundNumber roundName teamA teamB date time status'\)/.test(source),
  'saveSingleBet does not load the fields required by getBetLockState'
);
assert(
  /getBetLockState\(match, settings, now, dbMatches\)/.test(source),
  'saveSingleBet is not passing dbMatches to getBetLockState'
);

console.log('save-single-bet-regression: PASS');
