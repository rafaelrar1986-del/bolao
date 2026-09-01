
const assert = require('assert');
const fs = require('fs');

const backendUtil = fs.readFileSync(require.resolve('../utils/knockoutFormat'), 'utf8');
const frontend = fs.readFileSync(require.resolve('../../frontend/js/matches/matchesConfrontation.js'), 'utf8');
const points = fs.readFileSync(require.resolve('../services/pointsService'), 'utf8');
const updater = fs.readFileSync(require.resolve('../services/matchUpdater'), 'utf8');
const robot = fs.readFileSync(require.resolve('../controllers/robotController'), 'utf8');

assert(backendUtil.includes('buildKnockoutTieKey'));
assert(frontend.includes('match?.knockoutTieKey'));
assert(frontend.includes('candidateTieKey === currentTieKey'));
assert(frontend.includes("stage.startsWith('final ')"));
assert(frontend.includes("stage.startsWith('final-')"));
assert(!frontend.includes("(stage.includes('final') && !stage.includes('semi'))"));
assert(updater.includes('knockoutExpectedLegs'));
assert(updater.includes('legs.length < expectedLegs'));
assert(updater.includes('resolveKnockoutConfrontation'));
assert(robot.includes('materializeKnockoutConfrontation'));
assert(points.includes('realMatch.knockoutTieKey'));
console.log('knockout-cross-layer-regression: PASS');
