import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

function pidState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'dead';
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) {
    if (error.code === 'ESRCH') return 'dead';
    if (error.code === 'EPERM') return 'alive';
    return 'unavailable';
  }
}

export function observeProcessFingerprint(pid) {
  const state = pidState(pid);
  if (state !== 'alive') return {state, fingerprint: null};
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closing = stat.lastIndexOf(')');
      const fields = stat.slice(closing + 2).trim().split(/\s+/u);
      const startTicks = fields[19];
      const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      if (closing < 1 || !startTicks || !bootId) return {state: 'unavailable', fingerprint: null};
      return {state: 'observed', fingerprint: {scheme: 'linux-proc-startticks-v1', value: `${bootId}:${startTicks}`}};
    }
    if (process.platform === 'darwin') {
      const run = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {encoding: 'utf8', timeout: 5_000, env: {PATH: '', LC_ALL: 'C', LANG: 'C'}});
      const started = run.stdout?.trim();
      if (run.status !== 0 || run.error || run.signal || !started || started.includes('\n')) return {state: 'unavailable', fingerprint: null};
      return {state: 'observed', fingerprint: {scheme: 'darwin-ps-lstart-v1', value: started}};
    }
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || process.env.windir;
      if (!systemRoot || !path.isAbsolute(systemRoot)) return {state: 'unavailable', fingerprint: null};
      const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      if (!fs.existsSync(powershell)) return {state: 'unavailable', fingerprint: null};
      const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks)`;
      const run = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {encoding: 'utf8', timeout: 5_000, env: {SystemRoot: systemRoot, windir: systemRoot, PATH: ''}});
      const ticks = run.stdout?.trim();
      if (run.status !== 0 || run.error || run.signal || !/^\d+$/u.test(ticks)) return {state: 'unavailable', fingerprint: null};
      return {state: 'observed', fingerprint: {scheme: 'windows-starttime-ticks-v1', value: ticks}};
    }
  } catch {}
  return {state: 'unavailable', fingerprint: null};
}

export function classifyProcessOwner(owner) {
  const observed = observeProcessFingerprint(owner?.pid);
  if (observed.state === 'dead') return 'dead';
  if (observed.state !== 'observed' || !owner?.processFingerprint || typeof owner.processFingerprint.scheme !== 'string' || typeof owner.processFingerprint.value !== 'string') return 'unavailable';
  return observed.fingerprint.scheme === owner.processFingerprint.scheme && observed.fingerprint.value === owner.processFingerprint.value ? 'live' : 'stale-instance';
}
