import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/iu;

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase();
  return normalize(left) === normalize(right);
}

export function resolveRepositoryGitRoot(startPath) {
  let current = fs.realpathSync(path.resolve(startPath));
  if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  while (true) {
    const marker = path.join(current, '.git');
    if (fs.existsSync(marker)) {
      if (fs.lstatSync(marker).isSymbolicLink()) throw new Error(`拒绝使用符号链接 Git 标记：${marker}`);
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function readRepositoryGitCommit(startPath, {spawnGit = spawnSync} = {}) {
  const gitRoot = resolveRepositoryGitRoot(startPath);
  if (!gitRoot) return null;
  const result = spawnGit('git', ['-c', `safe.directory=${gitRoot}`, '-C', gitRoot, 'rev-parse', '--show-toplevel', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false
  });
  if (result?.status !== 0) return null;
  const [reportedRoot, commit, ...extra] = String(result.stdout || '').trim().split(/\r?\n/u);
  if (!reportedRoot || !commit || extra.length || !COMMIT_PATTERN.test(commit)) return null;
  let realReportedRoot;
  try { realReportedRoot = fs.realpathSync(path.resolve(reportedRoot)); } catch { return null; }
  return samePath(realReportedRoot, gitRoot) ? commit.toLowerCase() : null;
}
