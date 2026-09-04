
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const runtimePath = path.join(__dirname, '..', 'js', 'admin', 'adminRuntime.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app4.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');

// Exercise the real runtime functions in a tiny browser-like sandbox.
// Imports/exports and the R object are stripped only for this isolated test;
// the functions themselves come directly from adminRuntime.js.
const functionSource = runtimeSource
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/export const R = \{[\s\S]*?\n\};\nexport function registerAdminFunctions[\s\S]*$/m, '');

const store = new Map();
const context = {
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  }
};
vm.runInNewContext(`${functionSource}\nthis.__getAdminLeagueId = getAdminLeagueId;\nthis.__syncAdminLeagueWithSelectedLeague = syncAdminLeagueWithSelectedLeague;`, context);

// A stale administrative selection must be replaced by the participant's
// current league whenever the Admin panel is entered.
store.set('selectedLeagueId', 'A');
store.set('selectedLeagueName', 'Liga A');
store.set('adminSelectedLeagueId', 'B');
store.set('adminSelectedLeagueName', 'Liga B');

assert.strictEqual(context.__syncAdminLeagueWithSelectedLeague(), 'A');
assert.strictEqual(store.get('adminSelectedLeagueId'), 'A');
assert.strictEqual(store.get('adminSelectedLeagueName'), 'Liga A');
assert.strictEqual(context.__getAdminLeagueId(), 'A');

// Entering Admin must not mutate the participant's public league selection.
assert.strictEqual(store.get('selectedLeagueId'), 'A');
assert.strictEqual(store.get('selectedLeagueName'), 'Liga A');

// If the public league changes, a later Admin entry must follow it.
store.set('selectedLeagueId', 'C');
store.set('selectedLeagueName', 'Liga C');
assert.strictEqual(context.__syncAdminLeagueWithSelectedLeague(), 'C');
assert.strictEqual(store.get('adminSelectedLeagueId'), 'C');
assert.strictEqual(store.get('adminSelectedLeagueName'), 'Liga C');
assert.strictEqual(store.get('selectedLeagueId'), 'C');

// If no public league is selected, the sync function must not invent one.
store.delete('selectedLeagueId');
store.delete('selectedLeagueName');
store.set('adminSelectedLeagueId', 'B');
assert.strictEqual(context.__syncAdminLeagueWithSelectedLeague(), '');
assert.strictEqual(store.get('adminSelectedLeagueId'), 'B');

// Navigation must explicitly await the Admin-entry synchronization hook.
assert(appSource.includes("if (tab === 'admin' && currentUser?.isAdmin) {"));
assert(appSource.includes('await enterAdminPanel();'));
assert(appSource.includes("import('./admin.js?v=1.23')"));
assert(adminSource.includes('export async function enterAdminPanel()'));
assert(adminSource.includes('R.syncAdminLeagueWithSelectedLeague();'));
assert(adminSource.includes('R.AdminState.adminInitialized'));
assert(runtimeSource.includes('AdminState:{matches:[],leagues:[],adminInitialized:false}'));


console.log('✅ ADMIN LEAGUE ENTRY REGRESSION TESTS PASSED');
