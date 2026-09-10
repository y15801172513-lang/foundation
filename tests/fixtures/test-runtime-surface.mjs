import fs from 'node:fs';
import path from 'node:path';

let active = null;

export function configureRuntimeControl(control = null) {
  active = control ? structuredClone(control) : null;
}

export function currentRuntimeIdentity() {
  return Object.freeze({platform: active?.platform || process.env.FOUNDATION_TEST_RUNTIME_PLATFORM || process.platform, arch: active?.arch || process.env.FOUNDATION_TEST_RUNTIME_ARCH || process.arch});
}

function selected(name) {
  return active?.[name] || process.env[`FOUNDATION_TEST_${name.replaceAll(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`] || null;
}

export function operationCheckpoint(stage) {
  const faultAt = selected('faultAt');
  if (faultAt === stage) {
    const error = Object.assign(new Error(`测试故障注入：${stage}`), {name: 'LifecycleError', code: 'FAULT_INJECTED', stage, retryable: true});
    error.toJSON = () => ({schemaVersion: '1.0.0', code: error.code, stage: error.stage, retryable: error.retryable, message: error.message, recovery: null, details: {testFixture: true}});
    throw error;
  }
  const pauseAt = selected('pauseAt');
  if (pauseAt !== stage) return;
  const markerFile = active?.markerFile || process.env.FOUNDATION_TEST_MARKER_FILE;
  const releaseFile = active?.releaseFile || process.env.FOUNDATION_TEST_RELEASE_FILE;
  if (!markerFile || !path.isAbsolute(markerFile)) throw new Error(`test runtime checkpoint ${stage} 缺少绝对 marker`);
  fs.mkdirSync(path.dirname(markerFile), {recursive: true});
  fs.writeFileSync(markerFile, `${JSON.stringify({pid: process.pid, stage})}\n`);
  if (releaseFile) {
    while (!fs.existsSync(releaseFile)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    return;
  }
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
}

export function effectiveDiskAvailability(actualBytes) {
  const override = active?.availableBytes ?? (process.env.FOUNDATION_TEST_AVAILABLE_BYTES ? Number(process.env.FOUNDATION_TEST_AVAILABLE_BYTES) : null);
  return override === null || override === undefined ? actualBytes : Math.min(actualBytes, Number(override));
}

export function acquisitionNetworkDisconnected() {
  return Boolean(active?.networkDisconnected || process.env.FOUNDATION_TEST_NETWORK_DISCONNECTED === '1');
}

export function finalizerRuntimeEnvironment() {
  const faultAt = selected('faultAt');
  const finalizerPauseAt = active?.finalizerPauseAt || process.env.FOUNDATION_TEST_FINALIZER_PAUSE_AT || null;
  const markerFile = active?.markerFile || process.env.FOUNDATION_TEST_MARKER_FILE || null;
  return Object.freeze({
    NODE_OPTIONS: `--import=${new URL('../helpers/register-test-host.mjs', import.meta.url).href}`,
    ...(faultAt === 'uninstall-delete' ? {FOUNDATION_TEST_FAULT_AT: 'uninstall-delete'} : {}),
    ...(finalizerPauseAt ? {FOUNDATION_TEST_PAUSE_AT: finalizerPauseAt} : {}),
    ...(markerFile ? {FOUNDATION_TEST_MARKER_FILE: markerFile} : {}),
  });
}

export function currentManagerStateRoot() {
  const value = active?.managerStateRoot || process.env.FOUNDATION_TEST_MANAGER_STATE_ROOT;
  if (!value || !path.isAbsolute(value)) throw Object.assign(new Error('测试 manager state root 未配置'), {code: 'MANAGER_RUNTIME_STATE_UNAVAILABLE'});
  return path.resolve(value);
}
