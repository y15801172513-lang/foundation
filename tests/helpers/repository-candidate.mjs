import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from './project-fixture.mjs';

// Each caller builds current source into a fresh contained directory. Tests
// neither overwrite a maintainer's candidate nor rely on another test's order.
export function buildRepositoryCandidateForTest() {
  const boundary = path.join(ROOT, '.tmp');
  assert.equal(fs.realpathSync(boundary), boundary);
  assert.equal(fs.lstatSync(boundary).isSymbolicLink(), false);
  const work = fs.mkdtempSync(path.join(boundary, '030R1-repository-candidate-test-'));
  const candidate = path.join(work, 'candidate');
  const args = [path.join(ROOT, 'scripts/build-candidate.mjs'), '--work-root', path.join(work, 'build'), '--output', candidate];
  const run = spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}, maxBuffer: 64 * 1024 * 1024});
  fs.writeFileSync(path.join(work, 'build.stdout.log'), run.stdout || '');
  fs.writeFileSync(path.join(work, 'build.stderr.log'), run.stderr || '');
  fs.writeFileSync(path.join(work, 'build.result.json'), JSON.stringify({command:process.execPath,args,status:run.status,signal:run.signal,engineeringOnly:true},null,2));
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return {candidate, work};
}
