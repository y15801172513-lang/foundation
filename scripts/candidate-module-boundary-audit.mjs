import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {productVersion} from '../packages/core/product-version.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const candidateIndex = process.argv.indexOf('--candidate');
const artifactIndex = process.argv.indexOf('--artifact');
const CANDIDATE = path.resolve(candidateIndex >= 0 ? process.argv[candidateIndex + 1] : path.join(ROOT, '.tmp', 'candidates', `foundation-${productVersion(ROOT)}-${process.platform}-${process.arch}`));
const ARTIFACT = artifactIndex >= 0 ? path.resolve(process.argv[artifactIndex + 1]) : null;
const APP = path.join(CANDIDATE, 'payload', 'app');
const MANIFEST = path.join(CANDIDATE, 'manifest.json');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`candidate module audit rejects symlink: ${absolute}`);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
  return files;
}

function matchingDelimiter(source, open, opening, closing) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) { if (character === '\n') lineComment = false; continue; }
    if (blockComment) { if (character === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === opening) depth += 1;
    else if (character === closing && --depth === 0) return index;
  }
  return -1;
}

function functionsIn(source) {
  const functions = new Map();
  const pattern = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gu;
  for (const match of source.matchAll(pattern)) {
    const parameterOpen = source.indexOf('(', match.index);
    const parameterClose = matchingDelimiter(source, parameterOpen, '(', ')');
    const open = parameterClose >= 0 ? source.indexOf('{', parameterClose) : -1;
    const close = open >= 0 ? matchingDelimiter(source, open, '{', '}') : -1;
    if (close > open) functions.set(match[1], {name: match[1], start: match.index, end: close + 1, body: source.slice(match.index, close + 1)});
  }
  const names = [...functions.keys()];
  for (const record of functions.values()) record.calls = names.filter((name) => name !== record.name && new RegExp(`\\b${name}\\s*\\(`, 'u').test(record.body));
  return functions;
}

function isOrdered(body, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const next = body.indexOf(token, cursor + 1);
    if (next < 0) return false;
    cursor = next;
  }
  return true;
}

function probe(file) {
  const url = pathToFileURL(file).href;
  const source = `import crypto from 'node:crypto';const value=await import(${JSON.stringify(url)});const hash=(input)=>crypto.createHash('sha256').update(input).digest('hex');console.log(JSON.stringify(Object.keys(value).sort().map((name)=>({name,type:typeof value[name],sourceHash:typeof value[name]==='function'?hash(Function.prototype.toString.call(value[name])):hash(JSON.stringify(value[name]))}))));`;
  const environment = {...process.env, PATH: ''};
  delete environment.NODE_OPTIONS;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {cwd: ROOT, encoding: 'utf8', env: environment, timeout: 30_000});
  if (run.status !== 0) return {status: 'static-only', reason: run.signal || run.error?.code || `exit-${run.status}`, stderrHash: digest(run.stderr || '')};
  return {status: 'imported-isolated-empty-path', exports: JSON.parse(run.stdout)};
}

function pathsToWriters(root, functions, writerNames) {
  const results = [];
  const visit = (name, pathSoFar) => {
    if (pathSoFar.includes(name)) return;
    const pathNext = [...pathSoFar, name];
    if (writerNames.has(name)) results.push(pathNext);
    for (const called of functions.get(name)?.calls || []) visit(called, pathNext);
  };
  visit(root, []);
  return results;
}

if (!fs.existsSync(APP) || !fs.existsSync(MANIFEST)) throw new Error('candidate module audit requires an exact built candidate');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const forbiddenNames = new Set([
  'buildCandidate',
  'executeClosedProjectHandler',
  'restoreClosedHandlerWrites',
  'loadTrustedAuthorityKey',
  'signTrustedPayload',
  'writeTrustedPreIntent',
  'updateTrustedPreIntent',
  'acquireTrustedTargetGuard',
  'reclaimTrustedTargetGuard',
  'completeTrustedPreIntentRecovery',
  'invalidateCapabilitiesForUninstall',
]);
const genericForbiddenName = /(?:^|_)(?:write|restore|delete|sign|key|mint|configure|set)(?:$|[A-Z_])|execute.*handler|register.*handler/iu;
const writerToken = /\bfs\d*\.(?:appendFileSync|chmodSync|copyFileSync|linkSync|mkdirSync|renameSync|rmSync|rmdirSync|truncateSync|unlinkSync|writeFileSync)\s*\(/u;
const testToken = /FOUNDATION_(?:TEST|FINALIZER)|configureRuntimeControl|issueTestHumanAuthorization|test-host-loader|test-runtime-surface|test-protected-host-adapter/iu;
const modules = [];
const findings = [];

for (const file of walk(APP).sort()) {
  const relative = path.relative(APP, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  const imported = probe(file);
  const functions = functionsIn(source);
  const keyAccessFunctions = [...functions.values()].filter((record) => /receipt-finalizer-hmac\.key|crypto\d*\.randomBytes\(32\)/u.test(record.body)).map((record) => record.name).sort();
  const conditionallyCreatingHelpers = new Set(['ensureLedgerDirectory', 'loadTrustedAuthorityKey']);
  const writerNames = new Set([...functions.values()].filter((record) => writerToken.test(record.body) && !conditionallyCreatingHelpers.has(record.name)).map((record) => record.name));
  const transactionBoundaries = [...functions.values()].flatMap((record) => {
    if (isOrdered(record.body, ['reserveExactManagerConfirmationAtBoundary(', 'writeTrustedPreIntent(', 'acquireTrustedTargetGuard(', 'consumeExactManagerConfirmationAtBoundary('])) return [{function: record.name, kind: 'manager-reserve-preintent-guard-consume'}];
    if (isOrdered(record.body, ['verifyTrustedPayload(', 'verifyManagerConfirmedContinuationAtBoundary('])) return [{function: record.name, kind: 'signed-manager-confirmed-continuation'}];
    if (isOrdered(record.body, ['runWithLocalManagerConfirmation(', 'dispatch('])) return [{function: record.name, kind: 'local-manager-ui-confirm-and-dispatch'}];
    if (['requestLocalLifecyclePlan', 'storeRequestedPlan'].includes(record.name) && isOrdered(record.body, ['buildRequestedPlan(', 'planHash(', 'atomicJson('])) return [{function: record.name, kind: 'foundation-owned-pending-plan-only'}];
    if (record.name === 'createPendingLocalManagerSession' && record.body.includes('atomicJson(')) return [{function: record.name, kind: 'foundation-owned-manager-session-only'}];
    if (record.name === 'resolveLocalManagerPlanRefForInternalHost' && isOrdered(record.body, ['readPending(', 'createPendingLocalManagerSession(', 'atomicJson('])) return [{function: record.name, kind: 'opaque-plan-ref-to-manager-preview'}];
    if (record.name === 'runFirstInstallBootstrap' && isOrdered(record.body, ['createFirstInstallBootstrapPlan(', 'acquireBootstrapLauncherLock(', 'createLocalLifecycleManagerServer('])) return [{function: record.name, kind: 'candidate-self-hosted-bootstrap-manager'}];
    return [];
  });
  const boundaryNames = new Set(transactionBoundaries.map((entry) => entry.function));
  const exports = (imported.exports || []).map((entry) => {
    const paths = entry.type === 'function' ? pathsToWriters(entry.name, functions, writerNames) : [];
    const ungated = paths.filter((callPath) => !callPath.some((name) => boundaryNames.has(name)));
    const protectedHostOnly = relative.endsWith('/protected-host-adapter.mjs') || relative === 'packages/cli/protected-host-adapter.mjs';
    const classification = entry.type !== 'function' ? 'data-only'
      : protectedHostOnly ? 'protected-host-only'
        : paths.length ? (ungated.length ? 'forbidden-raw-mutation' : 'gated-mutation')
          : /(?:Plan|Effect|explain)/u.test(entry.name) ? 'plan-only'
            : 'read-only-or-inert';
    if (forbiddenNames.has(entry.name) || genericForbiddenName.test(entry.name) || ungated.length) findings.push({code: forbiddenNames.has(entry.name) || genericForbiddenName.test(entry.name) ? 'FORBIDDEN_DEEP_EXPORT' : 'UNGATED_EXPORTED_WRITER_PATH', module: relative, export: entry.name, paths: ungated});
    return {...entry, classification, writerPaths: paths};
  });
  if (imported.status !== 'imported-isolated-empty-path') findings.push({code: 'MODULE_IMPORT_UNCLASSIFIED', module: relative, reason: imported.reason});
  if (testToken.test(source)) findings.push({code: 'TEST_CONTROL_SHIPPED', module: relative});
  const exportedNames = new Set(exports.map((entry) => entry.name));
  const privateWriterFunctions = [...writerNames].filter((name) => !exportedNames.has(name)).sort();
  modules.push({
    path: relative,
    sha256: digest(source),
    importStatus: imported.status,
    importReason: imported.reason || null,
    exports,
    observedWriterFunctions: [...writerNames].sort(),
    privateKeyAccessFunctions: keyAccessFunctions.filter((name) => !exportedNames.has(name)),
    privateWriterFunctions,
    transactionBoundaries,
  });
}

const requiredAbsences = [
  'node_modules/@foundation/core/project-mutation-handlers.mjs',
  'node_modules/@foundation/core/trusted-authority.mjs',
  'node_modules/@foundation/core/trusted-intent-ledger.mjs',
];
for (const relative of requiredAbsences) if (fs.existsSync(path.join(APP, ...relative.split('/')))) findings.push({code: 'RAW_CORE_MODULE_SHIPPED', module: relative});

const resultSeed = {
  schemaVersion: '1.0.0',
  authority: 'exact-candidate-physical-module-tree',
  candidateContentHash: manifest.candidateHash,
  moduleCount: modules.length,
  moduleInventoryHash: digest(modules.map((entry) => `${entry.path}:${entry.sha256}`).join('\n')),
  modules,
  requiredRawModuleAbsences: requiredAbsences,
  unknownOrForbidden: findings,
};
const result = {...resultSeed, auditHash: digest(canonical(resultSeed)), ok: findings.length === 0};
const output = `${JSON.stringify(result, null, 2)}\n`;
if (ARTIFACT) {
  fs.mkdirSync(path.dirname(ARTIFACT), {recursive: true});
  fs.writeFileSync(ARTIFACT, output);
}
process.stdout.write(output);
if (!result.ok) process.exitCode = 1;
