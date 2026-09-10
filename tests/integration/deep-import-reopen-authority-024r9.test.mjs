import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildRepositoryCandidateForTest} from '../helpers/repository-candidate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let CANDIDATE;
let APP;

function isolated(source, arguments_ = []) {
  const environment = {...process.env, PATH: ''};
  delete environment.NODE_OPTIONS;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source, ...arguments_], {cwd: ROOT, encoding: 'utf8', env: environment});
}

function exportsOf(file) {
  const run = isolated(`const value=await import(${JSON.stringify(pathToFileURL(file).href)});console.log(JSON.stringify(Object.keys(value).sort()));`);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function candidateModules() {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) result.push(absolute);
    }
  };
  visit(APP);
  return result;
}

function withTestHost(source) {
  const environment = {...process.env, PATH: '', NODE_OPTIONS: `--import=${pathToFileURL(path.join(ROOT, 'tests', 'helpers', 'register-test-host.mjs')).href}`};
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {cwd: ROOT, encoding: 'utf8', env: environment});
}

function digestDirectory(root) {
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
      if (entry.isDirectory()) visit(absolute);
      else records.push(`${relative}:${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`);
    }
  };
  visit(root);
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex');
}

function digestPath(target) {
  if (!fs.existsSync(target)) return crypto.createHash('sha256').update('absent').digest('hex');
  if (fs.statSync(target).isDirectory()) return digestDirectory(target);
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function makeNegativeSurfaces(prefix, sourceProject = null) {
  const scope = fs.mkdtempSync(path.join(ROOT, '.tmp', prefix));
  const project = path.join(scope, 'project');
  if (sourceProject) fs.cpSync(sourceProject, project, {recursive: true});
  else {
    fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
    fs.writeFileSync(path.join(project, '.foundation', 'facts', 'sentinel.json'), '{"unchanged":true}\n');
    fs.writeFileSync(path.join(project, 'sentinel.txt'), 'unchanged\n');
  }
  const installationState = path.join(scope, 'installation-state');
  const cache = path.join(scope, 'cache');
  const log = path.join(scope, 'log');
  fs.mkdirSync(installationState, {recursive: true});
  fs.mkdirSync(cache, {recursive: true});
  fs.mkdirSync(log, {recursive: true});
  fs.writeFileSync(path.join(installationState, 'state.json'), '{"state":"unchanged"}\n');
  fs.writeFileSync(path.join(cache, 'sentinel'), 'unchanged\n');
  fs.writeFileSync(path.join(log, 'sentinel'), 'unchanged\n');
  const outside = path.join(scope, 'outside-root-sentinel.txt');
  fs.writeFileSync(outside, 'outside-unchanged\n');
  return {scope, project, installationState, cache, log, outside};
}

function snapshotNegativeSurfaces(surface) {
  const preference = path.join(ROOT, '.tmp', '027R1', 'test-host', 'authorization', 'offer-preference.json');
  const brokerLedger = path.join(ROOT, '.tmp', '027R1', 'test-host', 'authorization');
  const trustedLedger = path.join(ROOT, '.tmp', '.foundation-lifecycle-authority');
  return Object.fromEntries(Object.entries({
    project: surface.project,
    facts: path.join(surface.project, '.foundation', 'facts'),
    installationState: surface.installationState,
    preference,
    brokerLedger,
    trustedLedger,
    cache: surface.cache,
    log: surface.log,
    outside: surface.outside,
  }).map(([name, target]) => [name, digestPath(target)]));
}

test.before(() => {
  CANDIDATE = buildRepositoryCandidateForTest().candidate;
  APP = path.join(CANDIDATE, 'payload', 'app');
});

test('024R9 failing-first: exact candidate deep import exposes no raw handler writer or restore', () => {
  const inventory = candidateModules().map((file) => ({file, names: exportsOf(file)}));
  assert.equal(inventory.some(({names}) => names.some((name) => ['executeClosedProjectHandler', 'restoreClosedHandlerWrites', 'deriveClosedHandlerBinding', 'recordFoundationOfferDecision'].includes(name))), false);
  assert.equal(fs.existsSync(path.join(APP, 'node_modules', '@foundation', 'core', 'project-mutation-handlers.mjs')), false);
});

test('024R9 failing-first: exact candidate deep import exposes no arbitrary signer or key extractor', () => {
  const forbidden = new Set(['loadTrustedAuthorityKey', 'signTrustedPayload', 'writeTrustedPreIntent', 'updateTrustedPreIntent', 'acquireTrustedTargetGuard']);
  const inventory = candidateModules().map((file) => ({file, names: exportsOf(file)}));
  assert.deepEqual(inventory.flatMap(({file, names}) => names.filter((name) => forbidden.has(name)).map((name) => ({file, name}))), []);
  assert.equal(fs.existsSync(path.join(APP, 'node_modules', '@foundation', 'core', 'trusted-authority.mjs')), false);
});

test('026 replacement: exact candidate contains no old restore/host transition export and cannot change disposable project bytes', () => {
  const surface = makeNegativeSurfaces('024r9-deep-restore-');
  const before = snapshotNegativeSurfaces(surface);
  const urls = candidateModules().map((file) => pathToFileURL(file).href);
  const source = `let protectedRejections=0;for(const url of ${JSON.stringify(urls)}){const value=await import(url);for(const name of ['restoreClosedHandlerWrites','executeClosedProjectHandler','deriveClosedHandlerBinding','signTrustedPayload','loadTrustedAuthorityKey','writeTrustedPreIntent','recordFoundationOfferDecision','transitionOfferPreference']){if(typeof value[name]!=='function')continue;try{if(name==='transitionOfferPreference')value[name]({scope:{kind:'foundation-global'},transition:'reopen',requestedState:'reopened',directDecisionReference:{decisionId:'caller-fabricated'}});else value[name](process.argv[1],[{path:'injected.txt',exists:true,kind:'file',contentBase64:Buffer.from('bypass\\n').toString('base64'),mode:420}]);}catch(error){if(name==='transitionOfferPreference'&&error.code==='HUMAN_AUTHORIZATION_BROKER_UNAVAILABLE')protectedRejections+=1;else throw error;}}}console.log(JSON.stringify({protectedRejections}));`;
  const run = isolated(source, [surface.project]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).protectedRejections, 0);
  assert.deepEqual(snapshotNegativeSurfaces(surface), before);
});

test('024R9 failing-first: caller reopen and fabricated reference are inert when host provenance is unavailable', () => {
  const surface = makeNegativeSurfaces('024r9-reopen-negative-');
  const hashesBefore = snapshotNegativeSurfaces(surface);
  const offerUrl = pathToFileURL(path.join(ROOT, 'packages', 'core', 'offer-consent.mjs')).href;
  const source = `const value=await import(${JSON.stringify(offerUrl)});value.markFoundationOfferPresented();value.recordFoundationOfferDecision({decision:'decline'});const before=value.inspectFoundationOfferPreference();const reopened=value.recordFoundationOfferDecision({decision:'reopen',directDecisionReference:{decisionId:'caller-fabricated'}});const after=value.inspectFoundationOfferPreference();console.log(JSON.stringify({before,reopened,after}));`;
  const run = isolated(source);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.reopened.code, 'OFFER_REOPEN_AUTHORITY_UNAVAILABLE');
  assert.equal(result.reopened.applyAuthorized, false);
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(snapshotNegativeSurfaces(surface), hashesBefore);
});

test('024R9: exact candidate Skill, CLI and HTTP expose no caller-controlled reopen alias', async () => {
  const surface = makeNegativeSurfaces('024r9-alias-negative-', path.join(ROOT, 'examples', 'button-two-page'));
  const before = snapshotNegativeSurfaces(surface);
  const cli = path.join(APP, 'packages', 'cli', 'index.mjs');
  for (const arguments_ of [['offer', 'reopen'], ['capability', 'reopen'], ['project', 'reopen']]) {
    const run = spawnSync(process.execPath, [cli, ...arguments_], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PATH: '', NODE_OPTIONS: ''}});
    assert.notEqual(run.status, 0, arguments_.join(' '));
  }
  const serverUrl = pathToFileURL(path.join(APP, 'node_modules', '@foundation', 'management-center', 'src', 'server', 'index.mjs')).href;
  const source = `const {createManagementCenterServer}=await import(${JSON.stringify(serverUrl)});const server=createManagementCenterServer(process.argv[1]);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;const statuses=[];for(const method of ['GET','POST'])statuses.push((await fetch('http://127.0.0.1:'+port+'/__foundation/offer/reopen',{method})).status);await new Promise((resolve)=>server.close(resolve));console.log(JSON.stringify(statuses));`;
  const httpRun = isolated(source, [surface.project]);
  assert.equal(httpRun.status, 0, httpRun.stderr || httpRun.stdout);
  assert.deepEqual(JSON.parse(httpRun.stdout), [404, 404]);
  const skill = fs.readFileSync(path.join(APP, 'artifacts', 'skills', 'ai-product-foundation-kit', 'SKILL.md'), 'utf8');
  assert.match(skill, /AI 不能 durable decline、accept 或 reopen/u);
  assert.match(skill, /Foundation 本地管理器/u);
  assert.match(skill, /不得 confirm、apply、recover、purge/u);
  assert.deepEqual(snapshotNegativeSurfaces(surface), before);
});

test('024R9: exact candidate read-only CLI commands preserve every audited surface byte-for-byte', () => {
  const surface = makeNegativeSurfaces('024r9-readonly-candidate-', path.join(ROOT, 'examples', 'button-two-page'));
  const before = snapshotNegativeSurfaces(surface);
  const cli = path.join(APP, 'packages', 'cli', 'index.mjs');
  const manifest = path.join(APP, 'artifacts', 'skills', 'ai-product-foundation-kit', 'capability.json');
  const commands = [
    ['doctor', '--root', surface.installationState],
    ['status', '--root', surface.installationState],
    ['project', 'inventory', '--project', surface.project],
    ['capability', 'status', '--root', surface.installationState, '--manifest', manifest],
  ];
  for (const arguments_ of commands) {
    const run = spawnSync(process.execPath, [cli, ...arguments_], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PATH: '', NODE_OPTIONS: ''}});
    assert.equal(run.status, 0, `${arguments_.join(' ')}\n${run.stderr || run.stdout}`);
  }
  assert.deepEqual(snapshotNegativeSurfaces(surface), before);
});

test('024R9: exact candidate every-module import and derived call-boundary audit has zero unknowns', () => {
  const audit = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'candidate-module-boundary-audit.mjs'), '--candidate', CANDIDATE], {cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: {...process.env, PATH: '', NODE_OPTIONS: ''}});
  assert.equal(audit.error, undefined, audit.error?.message);
  assert.equal(audit.status, 0, audit.stderr || audit.stdout);
  const result = JSON.parse(audit.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.moduleCount, candidateModules().length);
  assert.deepEqual(result.unknownOrForbidden, []);
  assert.ok(result.modules.every((module) => module.importStatus === 'imported-isolated-empty-path'));
});

test('026 replacement: old protected test host cannot durably reopen an offer; manager settings plan is required', () => {
  const offerUrl = pathToFileURL(path.join(ROOT, 'packages', 'core', 'offer-consent.mjs')).href;
  const hostUrl = pathToFileURL(path.join(ROOT, 'tests', 'fixtures', 'test-protected-host-adapter.mjs')).href;
  const source = `const host=await import(${JSON.stringify(hostUrl)});const offer=await import(${JSON.stringify(offerUrl)});host.resetTestAuthorizationHost();offer.markFoundationOfferPresented();const declineRef=host.recordTestDirectOfferDecision('decline');offer.recordFoundationOfferDecision({decision:'decline',directDecisionReference:declineRef});const before=offer.inspectFoundationOfferPreference();const reopenRef=host.recordTestDirectOfferDecision('reopen');const reopened=offer.recordFoundationOfferDecision({decision:'reopen',directDecisionReference:reopenRef});const after=offer.inspectFoundationOfferPreference();console.log(JSON.stringify({before,reopened,after,evaluation:offer.evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true})}));`;
  const run = withTestHost(source);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.before.state, 'offered-awaiting-response');
  assert.equal(result.reopened.state, 'offered-awaiting-response');
  assert.equal(result.reopened.code, 'OFFER_REOPEN_AUTHORITY_UNAVAILABLE');
  assert.equal(result.reopened.durableDecisionRecorded, false);
  assert.equal(result.reopened.permission, 'open-foundation-settings-and-request-exact-plan');
  assert.equal(result.reopened.applyAuthorized, false);
  assert.equal(result.after.state, 'offered-awaiting-response');
  assert.equal(result.evaluation.decision, 'suppress');
});
