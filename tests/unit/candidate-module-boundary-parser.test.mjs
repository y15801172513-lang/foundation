import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('module audit keeps regex delimiters inside helpers and still rejects an exported raw writer', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  fs.mkdirSync(path.join(root, '.tmp'), {recursive: true});
  const candidate = fs.mkdtempSync(path.join(root, '.tmp', 'boundary-parser-'));
  fs.mkdirSync(path.join(candidate, 'payload/app'), {recursive: true});
  fs.writeFileSync(path.join(candidate, 'manifest.json'), JSON.stringify({candidateHash: 'isolated-parser-regression'}));
  const file = path.join(candidate, 'payload/app/probe.mjs');
  const source = `import fs from 'node:fs';
function readOnly(value) { return value.replace(/[^"'{}]+/gu, ''); }
export function inspect(value) { return readOnly(value); }
function rawMutation(target) { fs.writeFileSync(target, 'must not execute'); }
`;
  fs.writeFileSync(file, source);
  const audit = () => spawnSync(process.execPath, [path.join(root, 'scripts/candidate-module-boundary-audit.mjs'), '--candidate', candidate], {cwd: root, encoding: 'utf8', timeout: 30000});
  let run = audit();
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).ok, true);
  fs.writeFileSync(file, source + '\nexport function unsafe(target) { rawMutation(target); }\n');
  run = audit();
  assert.equal(run.status, 1, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.ok, false);
  fs.writeFileSync(file, source + '\nfunction recordAttempt(target) { fs.writeFileSync(target, \'must not execute\'); }\nexport function counterfeit(target) { recordAttempt(target); }\n');
  const counterfeit = audit();assert.equal(counterfeit.status,1);assert(JSON.parse(counterfeit.stdout).unknownOrForbidden.some(item=>item.export === 'counterfeit'));
  assert.ok(result.unknownOrForbidden.some(item => item.code === 'UNGATED_EXPORTED_WRITER_PATH' && item.export === 'unsafe' && item.paths.some(route => route.join('/') === 'unsafe/unsafe/rawMutation')));
});
