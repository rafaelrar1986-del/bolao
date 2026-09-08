import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const facade = read('js/ranking2.js');
const app4 = read('js/app4.js');
const myBets = read('js/myBets1.js');
const index = read('index.html');
const sw = read('sw-v5.js');

assert.match(facade, /from ['"]\.\/ranking\/controller\.js['"]/);
assert.match(facade, /export \{ loadRanking, initRanking, preloadRanking \}/);
assert.match(app4, /import\('\.\/ranking2\.js\?v=1\.10'\)/);
assert.match(app4, /window\.getUserRankingSummary/);
assert.match(myBets, /window\.__OFFICIAL_RANKING_CACHE__ \|\| window\.__RANKING_CACHE__/);
assert.match(index, /onclick="handleShareRanking\(\)"/);

for (const file of [
  'js/ranking/state.js',
  'js/ranking/helpers.js',
  'js/ranking/controller.js',
  'js/ranking/strategyRenderer.js',
  'js/ranking/simulation.js',
  'js/ranking/viewEvents.js',
  'js/ranking/uiActions.js'
]) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

for (const symbol of [
  '__LAST_SIMULATED_RANKING__', '__CRITICAL_MATCHES__', '__CURRENT_MATCHES__',
  '__getSimulationCardRequirements', '__isSimulationCardComplete',
  '__refreshSimulationControls', 'registerSimulation', 'updateSimulationScore',
  'handleShareRanking', 'getUserRankingSummary', 'showSimulatedRankingModal',
  'showCriticalMatchesModal', 'resetSimulations', 'toggleMiracleMode',
  'showMathExplanation'
]) {
  assert.match(facade + read('js/ranking/state.js') + read('js/ranking/helpers.js') + read('js/ranking/simulation.js') + read('js/ranking/uiActions.js'), new RegExp(`(?:window\\.)?${symbol.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`), `missing ${symbol}`);
}

assert.match(sw, /refactor-full-v9/);
assert.match(sw, /ranking2\.js\?v=1\.10/);
for (const file of ['state.js','helpers.js','controller.js','strategyRenderer.js','simulation.js','viewEvents.js','uiActions.js']) {
  assert.match(sw, new RegExp(`ranking/${file.replace('.', '\\.')}`), `service worker missing ranking/${file}`);
}

console.log('RANKING REFACTOR INTEGRATION REGRESSION TEST PASSED');
