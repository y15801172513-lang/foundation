import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {buildCandidate} from '../../packages/core/candidate-package.mjs';
import {LOCAL_LIFECYCLE_AI_TOOLS} from '../../packages/core/lifecycle-manager.mjs';
import {
  NODE_STARTUP_ENVIRONMENT_CONTRACT,
  NODE_STARTUP_SANITIZED_VARIABLES,
  posixNodeStartupEnvironmentBoundary,
  sanitizeNodeStartupEnvironment,
  windowsNodeStartupEnvironmentBoundary,
} from '../../packages/core/node-startup-environment.mjs';
import {platformShim} from '../../packages/core/platform-bootstrap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = path.join(ROOT, '.tmp', '027R2', 'test-focused');

function reset(name) {
  const root = path.join(TMP, name);
  fs.rmSync(root, {recursive: true, force: true});
  fs.mkdirSync(root, {recursive: true});
  return root;
}

function writeMarkers(root) {
  const markers = path.join(root, 'markers');
  fs.mkdirSync(markers, {recursive: true});
  const files = {
    import: path.join(markers, 'import-executed.txt'),
    require: path.join(markers, 'require-executed.txt'),
    loader: path.join(markers, 'loader-executed.txt'),
    nodePath: path.join(markers, 'node-path-executed.txt'),
  };
  fs.writeFileSync(path.join(markers, 'import.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(files.import)},'executed\\n');\n`);
  fs.writeFileSync(path.join(markers, 'require.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(files.require)},'executed\\n');\n`);
  fs.writeFileSync(path.join(markers, 'loader.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(files.loader)},'executed\\n');export async function resolve(s,c,n){return n(s,c)}\n`);
  const packageRoot = path.join(markers, 'node-path', 'foundation-external-marker');
  fs.mkdirSync(packageRoot, {recursive: true});
  fs.writeFileSync(path.join(packageRoot, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(files.nodePath)},'executed\\n');\n`);
  return {markers, files, importModule: path.join(markers, 'import.mjs'), requireModule: path.join(markers, 'require.cjs'), loaderModule: path.join(markers, 'loader.mjs'), nodePath: path.join(markers, 'node-path')};
}

function writeProbeEntrypoint(file) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `import {createRequire} from 'node:module';\nconst require=createRequire(import.meta.url);try{require('foundation-external-marker')}catch{}\nprocess.emitWarning('027R2 warning output probe');\nconst names=${JSON.stringify(NODE_STARTUP_SANITIZED_VARIABLES)};console.log(JSON.stringify({sanitized:Object.fromEntries(names.map(name=>[name,process.env[name]??null])),lang:process.env.LANG??null,forceColor:process.env.FORCE_COLOR??null}));\n`);
}

function poisonedEnvironment(marker, root) {
  return {
    ...process.env,
    PATH: '',
    NODE_OPTIONS: marker,
    NODE_PATH: path.join(root.markers, 'node-path'),
    NODE_V8_COVERAGE: path.join(root.markers, 'coverage-outside'),
    NODE_REDIRECT_WARNINGS: path.join(root.markers, 'redirected-warning.log'),
    NODE_COMPILE_CACHE: path.join(root.markers, 'compile-cache-outside'),
    NODE_COMPILE_CACHE_PORTABLE: '1',
    NODE_PRESERVE_SYMLINKS: '1',
    LANG: 'en_US.UTF-8',
    FORCE_COLOR: '0',
  };
}

function assertProbe(run, markerFiles, markersRoot) {
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.trim().split(/\r?\n/u).at(-1);
  const output = JSON.parse(line);
  assert.deepEqual(output.sanitized, Object.fromEntries(NODE_STARTUP_SANITIZED_VARIABLES.map((name) => [name, null])));
  assert.equal(output.lang, 'en_US.UTF-8');
  assert.equal(output.forceColor, '0');
  for (const marker of Object.values(markerFiles)) assert.equal(fs.existsSync(marker), false, marker);
  assert.equal(fs.existsSync(path.join(markersRoot, 'coverage-outside')), false);
  assert.equal(fs.existsSync(path.join(markersRoot, 'redirected-warning.log')), false);
  assert.equal(fs.existsSync(path.join(markersRoot, 'compile-cache-outside')), false);
}

test('027R2 shared contract removes only startup injection, external module and output path variables', () => {
  assert.deepEqual(NODE_STARTUP_SANITIZED_VARIABLES, ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'NODE_REDIRECT_WARNINGS', 'NODE_COMPILE_CACHE', 'NODE_COMPILE_CACHE_PORTABLE', 'NODE_PRESERVE_SYMLINKS']);
  const original = Object.fromEntries([...NODE_STARTUP_SANITIZED_VARIABLES.map((name) => [name, `caller-${name}`]), ['LANG', 'zh_CN.UTF-8'], ['FORCE_COLOR', '1'], ['FOUNDATION_SENTINEL', 'preserved']]);
  const sanitized = sanitizeNodeStartupEnvironment(original);
  for (const name of NODE_STARTUP_SANITIZED_VARIABLES) assert.equal(Object.hasOwn(sanitized, name), false);
  assert.equal(sanitized.LANG, 'zh_CN.UTF-8');
  assert.equal(sanitized.FORCE_COLOR, '1');
  assert.equal(sanitized.FOUNDATION_SENTINEL, 'preserved');
  assert.equal(Object.isFrozen(NODE_STARTUP_ENVIRONMENT_CONTRACT), true);
  assert.match(posixNodeStartupEnvironmentBoundary(), /^unset NODE_OPTIONS NODE_PATH /u);
  assert.doesNotMatch(posixNodeStartupEnvironmentBoundary(), /\benv\b|node/u);
  for (const name of NODE_STARTUP_SANITIZED_VARIABLES) assert.match(windowsNodeStartupEnvironmentBoundary(), new RegExp(`set "${name}="`, 'u'));
});

test('027R2 candidate launcher blocks import, require and experimental loader before bundled Node', () => {
  const root = reset('candidate-launcher');
  const marker = writeMarkers(root);
  const source = path.join(root, 'source');
  writeProbeEntrypoint(path.join(source, 'app', 'index.mjs'));
  const candidate = buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'candidate 空格 用户'), productVersion: '0.2.0', platform: process.platform, arch: process.arch, runtimeSource: process.execPath, entrypoint: 'app/index.mjs', sourceKind: 'local-test', buildIdentity: '027R2-focused'});
  const launcher = path.join(candidate.root, 'foundation-kit');
  for (const option of [`--import=${marker.importModule}`, `--require=${marker.requireModule}`, `--experimental-loader=${marker.loaderModule}`]) {
    const run = spawnSync(launcher, [], {cwd: root, encoding: 'utf8', env: poisonedEnvironment(option, marker)});
    assertProbe(run, marker.files, marker.markers);
  }
  const text = fs.readFileSync(launcher, 'utf8');
  assert.match(text, /unset NODE_OPTIONS NODE_PATH NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_COMPILE_CACHE_PORTABLE NODE_PRESERVE_SYMLINKS/u);
  assert.doesNotMatch(text, /test-focused|fixture|register-test-host|source-tree/u);
});

test('027R2 installed Unix shim enforces the same runtime boundary and Windows shim clears it before Node', () => {
  const root = reset('installed shim 空格 用户');
  const marker = writeMarkers(root);
  const runtimeRelative = 'runtimes/node/bin/node';
  const entryRelative = 'versions/0.2.0/app/index.mjs';
  const runtime = path.join(root, ...runtimeRelative.split('/'));
  fs.mkdirSync(path.dirname(runtime), {recursive: true});
  fs.copyFileSync(process.execPath, runtime);
  fs.chmodSync(runtime, 0o755);
  writeProbeEntrypoint(path.join(root, ...entryRelative.split('/')));
  const shim = path.join(root, 'bin', 'foundation-kit');
  fs.mkdirSync(path.dirname(shim), {recursive: true});
  fs.writeFileSync(shim, platformShim({platform: 'darwin', runtimePath: runtimeRelative, entrypoint: entryRelative}), {mode: 0o755});
  for (const option of [`--import=${marker.importModule}`, `--require=${marker.requireModule}`, `--experimental-loader=${marker.loaderModule}`]) {
    const run = spawnSync('/bin/sh', [shim], {cwd: path.dirname(root), encoding: 'utf8', env: poisonedEnvironment(option, marker)});
    assertProbe(run, marker.files, marker.markers);
  }
  const windows = platformShim({platform: 'win32', runtimePath: 'runtimes/node/bin/node.exe', entrypoint: 'versions/0.2.0/app/index.mjs'});
  assert.match(windows, /^@echo off\r\nsetlocal\r\n/u);
  for (const name of NODE_STARTUP_SANITIZED_VARIABLES) assert.ok(windows.indexOf(`set "${name}="`) < windows.indexOf('node.exe'));
  assert.match(windows, /exit \/b %errorlevel%/u);
});

test('027R2 CLI, manager and AI schemas cannot re-add startup variables', () => {
  const tools = JSON.stringify(LOCAL_LIFECYCLE_AI_TOOLS);
  for (const name of NODE_STARTUP_SANITIZED_VARIABLES) assert.equal(tools.includes(name), false);
  assert.deepEqual(Object.values(LOCAL_LIFECYCLE_AI_TOOLS).map((tool) => tool.name).sort(), ['Foundation:inspect', 'Foundation:open-manager', 'Foundation:request-plan', 'Foundation:status']);
  const cli = fs.readFileSync(path.join(ROOT, 'packages', 'cli', 'index.mjs'), 'utf8');
  assert.equal(cli.includes('--node-options'), false);
  assert.equal(cli.includes('--startup-environment'), false);
  assert.equal(cli.includes('--environment'), false);
});
