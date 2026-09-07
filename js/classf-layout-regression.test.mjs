import fs from 'node:fs';
import assert from 'node:assert/strict';

const css = fs.readFileSync(new URL('../css/styles4.css', import.meta.url), 'utf8');
const classf = fs.readFileSync(new URL('./classf.js', import.meta.url), 'utf8');

assert.match(classf, /classification-layout points-run-layout/);
assert.match(classf, /appendChild\(scorersSection\)/);
assert.match(css, /#classificacao \.points-run-layout \.top-scorers-section\s*\{[\s\S]*?grid-column:\s*2\s*!important;[\s\S]*?grid-row:\s*1;/);
assert.doesNotMatch(css, /#classificacao \.top-scorers-section\s*\{\s*grid-column:\s*1 \/ -1;/);
assert.match(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /styles4\.css\?v=1\.44/);
assert.match(fs.readFileSync(new URL('../sw-v5.js', import.meta.url), 'utf8'), /refactor-full-v8/);
console.log('CLASSIFICATION POINTS-RUN LAYOUT REGRESSION TEST PASSED');
