import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';

import {hashDirectory} from '@foundation/core';
import {makeScopedTempDirectory, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';

const worker = path.join(ROOT, 'tests', 'fixtures', 'project-transaction-worker-026r1.mjs');
const loader = `--import=${path.join(ROOT, 'tests', 'helpers', 'register-test-host.mjs')}`;
const operations = ['project-layout-migrate', 'project-data-purge', 'normal-uninstall-project-detach', 'normal-uninstall'];
const checkpoints = ['after-exclusive-guard', 'after-durable-pre-intent', 'after-snapshot-durable', 'after-confirmation-consume', 'write:generic-write', 'after-target-apply', 'after-postcondition-verify', 'after-durable-completion'];

function prepare(root) {
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(path.join(root, 'target.txt'), 'before\n', {mode: 0o604});
  fs.mkdirSync(path.join(root, 'empty-before'), {recursive: true, mode: 0o711});
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [worker, ...args], {cwd: ROOT, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: loader, PATH: '', ...env}});
}

test('026R1 durable protocol: every mutation family recovers in a fresh process at every checkpoint', (t) => {
  const fixture = makeScopedTempDirectory('026R1', 'transaction-restart-');
  t.after(() => removeTempDirectory(fixture));
  const evidence = [];
  for (const operation of operations) for (const checkpoint of checkpoints) {
    const caseId = `${operation}-${checkpoint.replaceAll(':', '-')}`;
    const root = path.join(fixture, caseId, 'target');
    const stateRoot = path.join(fixture, caseId, 'state');
    prepare(root);
    const before = hashDirectory(root);
    const operationId = `026r1-${sha(caseId)}`;
    const fault = run(['run', root, stateRoot, operation, operationId], {FOUNDATION_TEST_FAULT_AT: `project-transaction:${operation}:${checkpoint}`});
    assert.equal(fault.status, 2, `${caseId}: ${fault.stderr || fault.stdout}`);
    const recovery = run(['recover', root, stateRoot, operation, operationId]);
    assert.equal(recovery.status, 0, `${caseId}: ${recovery.stderr || recovery.stdout}`);
    const terminalAfter = checkpoint === 'after-durable-completion' || (operation === 'normal-uninstall' && ['after-target-apply', 'after-postcondition-verify'].includes(checkpoint));
    assert.equal(hashDirectory(root), terminalAfter ? hashAfter(root, operation) : before, caseId);
    evidence.push({operation, checkpoint, outcome: terminalAfter ? 'completed-or-resumed' : 'byte-exact-before'});
  }
  assert.equal(evidence.length, operations.length * checkpoints.length);
});

test('026R1 durable protocol: separate processes have one winner for every mutation family', async (t) => {
  const fixture = makeScopedTempDirectory('026R1', 'transaction-concurrency-');
  t.after(() => removeTempDirectory(fixture));
  for (const operation of operations) {
    const root = path.join(fixture, operation, 'target');
    const stateRoot = path.join(fixture, operation, 'state');
    const marker = path.join(fixture, operation, 'paused.json');
    const release = path.join(fixture, operation, 'release');
    prepare(root);
    const operationId = `026r1-${sha(`concurrency-${operation}`)}`;
    const first = spawn(process.execPath, [worker, 'run', root, stateRoot, operation, operationId], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_PAUSE_AT: `project-transaction:${operation}:after-snapshot-durable`, FOUNDATION_TEST_MARKER_FILE: marker, FOUNDATION_TEST_RELEASE_FILE: release}});
    await waitFor(marker);
    const loser = run(['run', root, stateRoot, operation, operationId]);
    assert.equal(loser.status, 2, `${operation}: second process unexpectedly won`);
    assert.match(loser.stderr, /PROJECT_TRANSACTION_LOCKED|PROJECT_TRANSACTION_REPLAYED/u);
    fs.writeFileSync(release, 'release\n');
    const winner = await collect(first);
    assert.equal(winner.code, 0, `${operation}: ${winner.stderr || winner.stdout}`);
    assert.equal(fs.readFileSync(path.join(root, 'target.txt'), 'utf8'), `after:${operation}\n`);
  }
});

function sha(value) {
  return Buffer.from(value).toString('hex').slice(0, 48).padEnd(48, '0');
}

function hashAfter(root, operation) {
  const temporary = path.join(path.dirname(root), 'expected-after');
  prepare(temporary);
  fs.writeFileSync(path.join(temporary, 'target.txt'), `after:${operation}\n`);
  fs.chmodSync(path.join(temporary, 'target.txt'), 0o640);
  fs.rmSync(path.join(temporary, 'empty-before'), {recursive: true, force: true});
  fs.mkdirSync(path.join(temporary, 'created-after'), {recursive: true});
  fs.writeFileSync(path.join(temporary, 'created-after', 'leaf.txt'), 'created\n');
  const hash = hashDirectory(temporary);
  fs.rmSync(temporary, {recursive: true, force: true});
  return hash;
}

async function waitFor(file) {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`等待 separate-process checkpoint 超时：${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function collect(child) {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({code, stdout, stderr}));
  });
}
