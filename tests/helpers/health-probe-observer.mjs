import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export function boundedHealthOutput(value) {
  const bytes = Buffer.from(value || '');
  let structured = null;
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (parsed && Object.keys(parsed).every((key) => ['ok', 'version', 'runtime'].includes(key))) {
      structured = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean' || typeof v === 'string' && /^[a-zA-Z0-9.+_-]{1,80}$/u.test(v)));
    }
  } catch {}
  // Unknown stdout/stderr is hash-only; paths, secrets and arbitrary child text never leak.
  return {bytes: bytes.length, sha256: digest(bytes), structured};
}

export function observeHealthSpawn(spawn, emit) {
  return function (...parameters) {
    const [executable, args, options] = parameters;
    if (args?.at(-1) !== '--foundation-health' || options?.env?.FOUNDATION_HEALTH_PROBE !== '1') return spawn(...parameters);
    const stat = fs.statSync(executable);
    const identity = {sha256: digest(fs.readFileSync(executable)), bytes: stat.size, mode: stat.mode & 0o7777, pathSha256: digest(executable)};
    const id = crypto.randomUUID(), start = new Date().toISOString(), clock = performance.now();
    emit({phase: 'start', id, pid: process.pid, start, executable: identity, timeout: options.timeout});
    let result, thrown;
    try { result = spawn(...parameters); return result; }
    catch (error) { thrown = error; throw error; }
    finally {
      emit({phase: 'end', id, pid: process.pid, start, end: new Date().toISOString(), durationMs: performance.now() - clock,
        executable: identity, timeout: options.timeout, status: result?.status ?? null, signal: result?.signal ?? null,
        error: (thrown || result?.error)?.code || null, stdout: boundedHealthOutput(result?.stdout), stderr: boundedHealthOutput(result?.stderr)});
    }
  };
}

const logRoot = process.env.FOUNDATION_TEST_HEALTH_LOG;
if (logRoot) {
  const source = path.resolve(import.meta.dirname, '../..');
  const enclosingTmp = source.indexOf(`${path.sep}.tmp${path.sep}`);
  if (enclosingTmp < 0 || !path.isAbsolute(logRoot)) throw new Error('健康取证只允许包含在 task-owned .tmp 中的测试副本');
  const outer = source.slice(0, enclosingTmp) + source.slice(enclosingTmp).split(path.sep).slice(0, 3).join(path.sep);
  if (!logRoot.startsWith(`${outer}${path.sep}`) || fs.realpathSync(logRoot) !== logRoot || !fs.statSync(logRoot).isDirectory()) throw new Error('健康取证日志逃出测试拥有根');
  const output = path.join(logRoot, `health-${process.pid}.jsonl`);
  if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || !fs.statSync(output).isFile())) throw new Error('健康取证日志类型非法');
  childProcess.spawnSync = observeHealthSpawn(childProcess.spawnSync, (record) => fs.appendFileSync(output, `${JSON.stringify(record)}\n`, {mode: 0o600}));
  syncBuiltinESMExports();
}
