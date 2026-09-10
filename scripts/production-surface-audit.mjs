import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const candidateArgument = process.argv.indexOf('--candidate');
const candidateRoot = candidateArgument >= 0 ? path.resolve(process.argv[candidateArgument + 1] || '') : null;
const surfaceRoot = candidateRoot ? path.join(candidateRoot, 'payload', 'app') : ROOT;
const coreRoot = candidateRoot ? path.join(surfaceRoot, 'node_modules', '@foundation', 'core') : path.join(ROOT, 'packages', 'core');
const cliRoot = candidateRoot ? path.join(surfaceRoot, 'packages', 'cli') : path.join(ROOT, 'packages', 'cli');
const findings = [];

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parameterText(functionSource) {
  const start = functionSource.indexOf('(');
  if (start < 0) return '';
  let depth = 0;
  for (let index = start; index < functionSource.length; index += 1) {
    if (functionSource[index] === '(') depth += 1;
    if (functionSource[index] === ')') {
      depth -= 1;
      if (depth === 0) return functionSource.slice(start + 1, index);
    }
  }
  return functionSource;
}

function walk(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) findings.push({code: 'PRODUCTION_SYMLINK', path: path.relative(root, absolute).replaceAll(path.sep, '/')});
      else if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

if (candidateRoot) {
  const boundaryScript = path.join(ROOT, 'scripts', 'candidate-module-boundary-audit.mjs');
  const run = spawnSync(process.execPath, [boundaryScript, '--candidate', candidateRoot], {cwd: ROOT, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  let boundary;
  try { boundary = JSON.parse(run.stdout); }
  catch { boundary = {ok: false, moduleCount: 0, modules: [], moduleInventoryHash: null, auditHash: null, unknownOrForbidden: [{code: 'CANDIDATE_MODULE_AUDIT_OUTPUT_INVALID', exitCode: run.status, stderrHash: hash(run.stderr || '')}]}; }
  const result = {
    schemaVersion: '1.0.0',
    ok: run.status === 0 && boundary.ok === true,
    surface: 'candidate-every-physical-module',
    publicExportCount: boundary.modules.reduce((count, module) => count + module.exports.length, 0),
    inspectedFileCount: boundary.moduleCount,
    inspectedCodeFileCount: boundary.moduleCount,
    treeHash: boundary.moduleInventoryHash,
    boundaryAuditHash: boundary.auditHash,
    findings: boundary.unknownOrForbidden,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} else if (!fs.existsSync(path.join(coreRoot, 'index.mjs')) || !fs.existsSync(path.join(cliRoot, 'index.mjs'))) {
  findings.push({code: 'PRODUCTION_SURFACE_MISSING', coreRoot: Boolean(fs.existsSync(coreRoot)), cliRoot: Boolean(fs.existsSync(cliRoot))});
} else {
  const publicCore = await import(`${pathToFileURL(path.join(coreRoot, 'index.mjs')).href}?surface-audit=024r8`);
  const exportNames = Object.keys(publicCore).sort();
  const forbiddenExports = [
    'applyLifecyclePlan',
    'applyCapabilityPlan',
    'applyProjectAuthorityPlan',
    'applyProjectAuthorityRecoveryPlan',
    'applyProjectMutationPlan',
    'applyProjectMutationRecoveryPlan',
    'applyProjectLayoutPlan',
    'applyNormalUninstallProjectPlan',
    'applyNormalUninstallCompositePlan',
    'recoverLifecycleState',
    'recoverProjectTransaction',
    'configureRuntimeControl',
    'executeAuthorizedProjectMutation',
    'executeClosedProjectHandler',
    'issueTestHumanAuthorization',
    'loadTrustedAuthorityKey',
    'registerProjectMutationHandler',
    'resetInMemoryOfferSuppressionForTest',
    'setProjectMutationHandler',
    'signTrustedPayload',
    'verifyTrustedPayload',
  ];
  for (const name of forbiddenExports) if (exportNames.includes(name)) findings.push({code: 'FORBIDDEN_PUBLIC_EXPORT', name});
  for (const name of exportNames.filter((value) => /(?:ForTest|TestOnly|fault|processControl)/iu.test(value))) findings.push({code: 'TEST_NAMED_PUBLIC_EXPORT', name});

  const signatureTargets = ['inspectLocalLifecycle', 'requestLocalLifecyclePlan', 'openLocalLifecycleManagerPlan', 'readLocalLifecycleOperationStatus', 'createLifecyclePlan', 'createCapabilityPlan', 'inspectCapabilityStatus', 'runtimeStrategy'];
  const signatureHashes = {};
  for (const name of signatureTargets) {
    if (typeof publicCore[name] !== 'function') { findings.push({code: 'EXPECTED_PUBLIC_FUNCTION_MISSING', name}); continue; }
    const functionSource = Function.prototype.toString.call(publicCore[name]);
    const parameters = parameterText(functionSource);
    signatureHashes[name] = hash(functionSource);
    for (const forbidden of ['mutate', 'callback', 'faultAt', 'processControl', 'handlerModule', 'modulePath', 'hostRegistrationIdentity']) if (new RegExp(`\\b${forbidden}\\b`, 'u').test(parameters)) findings.push({code: 'FORBIDDEN_CALLABLE_PARAMETER', name, parameter: forbidden});
    if (['createLifecyclePlan', 'runtimeStrategy'].includes(name) && /\b(?:platform|arch)\b/u.test(parameters)) findings.push({code: 'RUNTIME_IDENTITY_OVERRIDE_PARAMETER', name});
  }

  const packageManifest = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
  const packageExports = Object.keys(packageManifest.exports || {}).sort();
  for (const forbidden of ['./trusted-authority', './protected-host-adapter', './project-mutation-handlers', './runtime-surface', './trusted-intent-ledger']) if (packageExports.includes(forbidden)) findings.push({code: 'INTERNAL_SUBPATH_EXPORTED', subpath: forbidden});
  if (packageExports.some((entry) => entry.includes('*'))) findings.push({code: 'WILDCARD_PACKAGE_EXPORT'});

  const files = candidateRoot
    ? walk(surfaceRoot)
    : [
        ...walk(coreRoot),
        ...walk(cliRoot),
        ...walk(path.join(ROOT, 'apps', 'management-center', 'src', 'server')),
      ];
  const relativeFiles = files.map((file) => path.relative(surfaceRoot, file).replaceAll(path.sep, '/')).sort();
  for (const relative of relativeFiles) if (/(?:^|\/)(?:tests?|fixtures?)(?:\/|$)|test-host-loader|test-runtime-surface|test-protected-host-adapter|register-test-host/iu.test(relative)) findings.push({code: 'TEST_FILE_SHIPPED', path: relative});
  const inspectedCode = files.filter((file) => /\.(?:mjs|js|json)$/u.test(file));
  for (const file of inspectedCode) {
    const content = fs.readFileSync(file, 'utf8');
    for (const token of ['configureRuntimeControl', 'FOUNDATION_TEST_', 'issueTestHumanAuthorization', 'resetInMemoryOfferSuppressionForTest', 'test-host-loader', 'test-runtime-surface']) if (content.includes(token)) findings.push({code: 'TEST_CONTROL_SHIPPED', path: path.relative(surfaceRoot, file).replaceAll(path.sep, '/'), token});
  }
  const runtimeSource = fs.readFileSync(path.join(coreRoot, 'runtime-surface.mjs'), 'utf8');
  if (!runtimeSource.includes('platform: process.platform') || !runtimeSource.includes('arch: process.arch')) findings.push({code: 'RUNTIME_IDENTITY_NOT_ACTUAL'});
  const protectedHostSource = fs.readFileSync(path.join(coreRoot, 'protected-host-adapter.mjs'), 'utf8');
  if (!protectedHostSource.includes("code: 'CAPABILITY_HOST_REGISTRATION_UNAVAILABLE'") || /export function (?:set|register|inject).*Host/iu.test(protectedHostSource)) findings.push({code: 'PROTECTED_HOST_SURFACE_INVALID'});
  for (const file of inspectedCode.filter((entry) => entry !== path.join(coreRoot, 'protected-host-adapter.mjs'))) {
    if (fs.readFileSync(file, 'utf8').includes("from './protected-host-adapter.mjs'")) findings.push({code: 'PROTECTED_HOST_PRODUCTION_DEPENDENCY', path: path.relative(surfaceRoot, file).replaceAll(path.sep, '/')});
  }

  const treeRecords = relativeFiles.map((relative) => `${relative}:${hash(fs.readFileSync(path.join(surfaceRoot, ...relative.split('/'))))}`);
  const result = {
    schemaVersion: '1.0.0',
    ok: findings.length === 0,
    surface: candidateRoot ? 'candidate' : 'source',
    publicExportCount: exportNames.length,
    publicExports: exportNames,
    packageExports,
    inspectedFileCount: relativeFiles.length,
    inspectedCodeFileCount: inspectedCode.length,
    treeHash: hash(treeRecords.join('\n')),
    signatureHashes,
    findings,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (findings.length && !fs.existsSync(path.join(coreRoot, 'index.mjs'))) {
  process.stdout.write(`${JSON.stringify({schemaVersion: '1.0.0', ok: false, surface: candidateRoot ? 'candidate' : 'source', findings}, null, 2)}\n`);
  process.exitCode = 1;
}
