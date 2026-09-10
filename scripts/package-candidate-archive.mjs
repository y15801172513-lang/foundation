import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {validateCandidate} from '../packages/core/candidate-package.mjs';
import {sha256} from '../packages/core/install-contract.mjs';

// Build-side only. Never installs, acquires a signing identity, or publishes.
const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const boundary = fs.realpathSync(path.join(root, '.tmp'));
const args = process.argv.slice(2);
const options = {};
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--candidate', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('仅支持一次 --candidate <目录> 和 --output <tar.gz>');
    options[args[i]] = path.resolve(args[i + 1]);
  }
  function contained(target) {
    if (!target || !target.startsWith(boundary + path.sep)) throw new Error('归档只允许当前项目 .tmp 内路径');
    let cursor = boundary;
    for (const part of path.relative(boundary, target).split(path.sep)) {
      cursor = path.join(cursor, part);
      try { if (fs.lstatSync(cursor).isSymbolicLink() || fs.realpathSync(cursor) !== cursor) throw new Error('归档拒绝符号链接或路径别名'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  const candidate = contained(options['--candidate']);
  const output = contained(options['--output']);
  if (!output.endsWith('.tar.gz') || fs.existsSync(output) || fs.existsSync(output + '.json')) throw new Error('归档输出须为新的 .tar.gz，不覆盖已有产物或回执');
  const checked = validateCandidate(candidate, {platform: process.platform, arch: process.arch, requireRuntime: true});
  if (!checked.ok) throw new Error(`候选不能归档：${checked.error.code}`);
  if (!fs.existsSync(path.dirname(output))) throw new Error('请先在 .tmp 准备真实输出父目录');
  const work = fs.mkdtempSync(path.join(boundary, '030R1-archive-'));
  const staged = path.join(work, 'candidate');
  fs.cpSync(candidate, staged, {recursive: true, verbatimSymlinks: true});
  const instant = new Date('2000-01-01T00:00:00Z');
  function normalize(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('归档 staging 出现符号链接');
      if (entry.isDirectory()) normalize(file);
      else if (!entry.isFile()) throw new Error('归档 staging 出现特殊文件');
      fs.utimesSync(file, instant, instant);
    }
    fs.utimesSync(directory, instant, instant);
  }
  normalize(staged);
  const pack = (destination) => {
    const tarFile = destination + '.tar';
    const result = spawnSync('/usr/bin/tar', ['--format=ustar', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'wheel', '-cf', tarFile, '-C', staged, '.'], {env: {PATH: '', LANG: 'C', TZ: 'UTC'}, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024});
    if (result.status !== 0) throw new Error(`归档失败：${result.stderr || result.error?.message || result.status}`);
    // Node zlib emits a zero mtime and no output filename in the gzip header.
    fs.writeFileSync(destination, gzipSync(fs.readFileSync(tarFile), {level: 9}), {flag: 'wx', mode: 0o600});
  };
  const first = path.join(work, 'first.tar.gz');
  const second = path.join(work, 'second.tar.gz');
  pack(first); pack(second);
  const bytes = fs.readFileSync(first);
  if (sha256(bytes) !== sha256(fs.readFileSync(second))) throw new Error('同 staging 两次归档不一致，不交付');
  const members = [{path: 'manifest.json', size: fs.statSync(path.join(candidate, 'manifest.json')).size, sha256: sha256(fs.readFileSync(path.join(candidate, 'manifest.json')))}, {path: 'foundation-kit', size: checked.manifest.launcher.size, sha256: checked.manifest.launcher.sha256}, ...checked.manifest.files.map((entry) => ({path: `payload/${entry.path}`, size: entry.size, sha256: entry.sha256}))];
  if (checked.manifest.signature.status === 'verified') members.push({path: 'distribution-signature.json', size: fs.statSync(path.join(candidate, 'distribution-signature.json')).size, sha256: sha256(fs.readFileSync(path.join(candidate, 'distribution-signature.json')))});
  for (const member of members) {
    const result = spawnSync('/usr/bin/tar', ['-xOzf', first, `./${member.path}`], {env: {PATH: '', LANG: 'C'}, timeout: 30000, maxBuffer: Math.max(1024 * 1024, member.size + 1024)});
    if (result.status !== 0 || result.stdout.length !== member.size || sha256(result.stdout) !== member.sha256) throw new Error(`归档成员复验失败：${member.path}`);
  }
  fs.copyFileSync(first, output, fs.constants.COPYFILE_EXCL);
  if (sha256(fs.readFileSync(output)) !== sha256(bytes)) throw new Error('交付归档落盘摘要变化');
  const receipt = {schemaVersion: '1.0.0', candidateHash: checked.manifest.candidateHash, version: checked.manifest.productVersion, platform: checked.manifest.platform, arch: checked.manifest.arch, sha256: sha256(bytes), bytes: bytes.length, signature: checked.manifest.signature, runtime: checked.manifest.runtime, membersReverified: members.length, deterministicPair: true, published: false, realUserAccepted: false};
  fs.writeFileSync(output + '.json', JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({archive: output, receipt: output + '.json', ...receipt}, null, 2));
} catch (error) { console.error(`错误：${error.message}`); process.exitCode = 1; }
