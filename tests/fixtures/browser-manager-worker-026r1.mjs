import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {hashDirectory} from '@foundation/core';
import {createLocalLifecycleManagerServer, createLocalLifecycleManagerServerForPlanRef} from '../../packages/core/lifecycle-manager-host.mjs';
import {requestLocalLifecyclePlan} from '../../packages/core/lifecycle-manager.mjs';
import {createProjectLayoutMigrationPlan} from '../../packages/core/project-layout.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const [scenario = 'cancel', markerFile] = process.argv.slice(2);
if (!['cancel', 'confirm', 'drift'].includes(scenario) || !markerFile || !path.isAbsolute(markerFile)) throw new Error('usage: browser-manager-worker-026r1 <cancel|confirm|drift> <absolute-marker-file>');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function request(port, {method = 'GET', pathname = '/', headers = {}, body = ''} = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({host: '127.0.0.1', port, method, path: pathname, headers}, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

async function confirmDirect(plan, stateRoot) {
  const server = createLocalLifecycleManagerServer({plan, stateRoot});
  const port = await listen(server);
  try {
    const preview = await request(port);
    const managerNonce = /name="managerNonce" value="([^"]+)"/u.exec(preview.body)?.[1];
    const result = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce, action: 'confirm-exact-operation'})});
    if (result.status !== 200) throw new Error(`fixture migration failed: ${result.body}`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

fs.mkdirSync(path.join(ROOT, '.tmp', '026R1', 'browser'), {recursive: true});
const fixtureRoot = fs.mkdtempSync(path.join(ROOT, '.tmp', '026R1', 'browser', `${scenario}-`));
const project = path.join(fixtureRoot, 'project');
const stateRoot = path.join(fixtureRoot, 'manager-state');
process.env.FOUNDATION_TEST_MANAGER_STATE_ROOT = stateRoot;
fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
fs.mkdirSync(path.join(project, 'src'), {recursive: true});
writeJson(path.join(project, '.foundation', 'foundation.json'), {projectId: `browser-${scenario}`, dataFormatVersion: '0.1.0'});
writeJson(path.join(project, '.foundation', 'facts', 'project.json'), {items: [{id: 'browser-fact', value: 'must survive'}]});
fs.writeFileSync(path.join(project, 'src', 'index.js'), `export const scenario = ${JSON.stringify(scenario)};\n`);

if (scenario === 'cancel') {
  await confirmDirect(createProjectLayoutMigrationPlan({project}), path.join(fixtureRoot, 'setup-manager'));
  fs.writeFileSync(path.join(project, '.foundation', 'generated-cache', 'user-visible.txt'), 'preserve browser residual\n');
  fs.mkdirSync(path.join(project, '.foundation', 'integration', 'unknown-nested'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'integration', 'unknown-nested', 'user.txt'), 'preserve nested unknown\n');
}

const parameters = scenario === 'cancel'
  ? {projects: [{projectId: `browser-${scenario}`, realPath: project}], resultFile: path.join(fixtureRoot, 'residual-result.json')}
  : {project};
const operation = scenario === 'cancel' ? 'normal-uninstall-project-detach' : 'project-layout-migrate';
const requested = requestLocalLifecyclePlan({operation, parameters});
const server = createLocalLifecycleManagerServerForPlanRef({planRef: requested.planRef});
const port = await listen(server);
const beforeHash = hashDirectory(project);
if (scenario === 'drift') fs.appendFileSync(path.join(project, 'src', 'index.js'), '// browser drift before click\n');
writeJson(markerFile, {
  scenario,
  fixtureRoot,
  project,
  stateRoot,
  planRef: requested.planRef,
  beforeHash,
  afterInjectedDriftHash: hashDirectory(project),
  url: `http://127.0.0.1:${port}/`,
  statusUrl: `http://127.0.0.1:${port}/__foundation/manager/status`,
  pid: process.pid,
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
setInterval(() => {}, 60_000);
