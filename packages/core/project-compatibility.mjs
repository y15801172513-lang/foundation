import fs from 'node:fs';
import path from 'node:path';
import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {verifyTrustedPayload} from './trusted-authority.mjs';
import {requiredFactCapabilities} from './asset-model.mjs';
import {FACT_FILES} from './fact-file-names.mjs';

// A signed registry authenticates a past binding, not today's directory. Portable
// IDs/hashes can be copied: they never replace the filesystem identity check.
export function assertRetainedProjectCapabilities(root, appRoot, {operation = 'update', currentVersion = null, targetVersion = null, expected = null} = {}) {
  const versions = [currentVersion, targetVersion].every(v => /^\d+\.\d+\.\d+$/.test(v || ''));
  const direction = versions ? targetVersion.split('.').map(Number).reduce((result, value, index) => result || Math.sign(value - Number(currentVersion.split('.')[index])), 0) : 0;
  const label = operation === 'rollback' ? '回退' : operation === 'repair' ? '修复' : direction > 0 ? '升级' : direction < 0 ? '降级' : '更新';
  const files = [];
  let project = null, projectId = null;
  const reject = (reason, message, extra = {}, code = 'PROJECT_COMPATIBILITY_UNKNOWN') => {
    throw new LifecycleError(code, `${label}前项目核验失败${project ? `：${project}` : ''}；${message}`, {
      stage: 'project-compatibility', recovery: reason === 'device-changed'
        ? '设备编号变化不能单独证明目录仍是原项目。核对项目后，请求 enable（rebind:true）的新计划并本人确认；按需明确重新授予持续同步，原停用项目重新绑定后再单独停用。完成后重新生成更新计划，不重放旧确认。'
        : '保留原安装和项目资料。先恢复缺失项目或有效绑定；需要改变绑定时，通过本地管理器生成显式重新绑定计划并本人确认，不编辑登记 JSON 或绕过签名。',
      details: {project, projectId, reason, operation, currentVersion, targetVersion, ...extra},
    });
  };
  const read = file => {
    try {
      if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) reject('unsafe-path', `路径不是无符号链接的普通文件：${file}`);
      const bytes = fs.readFileSync(file); files.push({file, sha256: sha256(bytes)});
      return JSON.parse(bytes);
    } catch (error) {
      if (error instanceof LifecycleError) throw error;
      reject('missing-or-invalid-file', `无法读取核验文件：${file}`, {file, errorCode: error.code || 'INVALID_JSON'});
    }
  };
  const signed = file => {
    const {integrity, ...payload} = read(file);
    if (!verifyTrustedPayload(payload, integrity)) reject('invalid-signature', `签名无效：${file}`);
    return payload;
  };
  const registryFile = path.join(root, 'state/projects.json');
  const present = (() => {try {fs.lstatSync(registryFile);return true;} catch (error) {if(error.code==='ENOENT')return false;reject('registry-unreadable','项目登记不可读取',{errorCode:error.code});}})();
  if (present) {
    const registry = signed(registryFile), current = signed(path.join(root, 'state/current.json'));
    if (registry.schemaVersion !== '1.0.0' || registry.bindingVersion !== '2.0.0' || registry.installId !== current.identity?.installId || !registry.projects || Array.isArray(registry.projects)) reject('installation-binding-mismatch', '项目登记不属于当前安装或格式不受支持');
    const descriptor = read(path.join(appRoot, 'foundation-runtime-descriptor.json'));
    for (const [id, record] of Object.entries(registry.projects)) {
      project = record.realPath; projectId = id;
      if (typeof project !== 'string' || !path.isAbsolute(project) || path.resolve(project) !== project || record.projectId !== id || !['enabled', 'disabled'].includes(record.state)) reject('invalid-registration', '项目登记格式无效');
      let stat;
      try {stat = fs.lstatSync(project);} catch {reject('project-missing', '登记项目不存在；不能证明兼容性');}
      if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(project) !== project) reject('unsafe-project-path', '项目路径包含符号链接或不是原真实目录');
      const observed = {device: String(stat.dev), inode: String(stat.ino), kind: 'directory'};
      const before = record.projectIdentity;
      const canonical = project.normalize('NFC').replaceAll('\\', '/').toLocaleLowerCase('en-US');
      if (record.canonicalPath !== canonical) reject('path-mismatch', '登记路径不一致');
      if (before?.inode !== observed.inode || before?.kind !== observed.kind) reject('directory-replaced', '目录身份变化，不能将同路径的新目录视作原绑定项目', {registered: before, observed});
      const portableFile = path.join(project, '.foundation/integration/binding.json');
      const portable = read(portableFile), identity = read(path.join(project, '.foundation/identity/project.json'));
      if (record.portableBindingHash !== files.find(f => f.file === portableFile).sha256 || portable.schemaVersion !== '1.0.0' || portable.layoutVersion !== '2.0.0' || portable.projectId !== id || portable.identity?.value !== id || portable.identity?.scheme !== 'foundation-project-id-v2' || portable.bindingVersion !== registry.bindingVersion || portable.state !== record.state || identity.projectId !== id || identity.identityScheme !== 'foundation-project-id-v2') reject('portable-binding-mismatch', '项目身份、绑定文件与签名登记不一致');
      if (before.device !== observed.device) reject('device-changed', '设备编号变化；已有签名与项目 ID 仍不足以自动确认目录连续性', {registered: before, observed, portableBindingVerified: true});
      files.push({project, identity: observed});
      const facts = {};
      for (const kind of FACT_FILES) {
        const file = path.join(project, '.foundation/facts', kind + '.json');
        if (fs.existsSync(file)) facts[kind] = read(file);
      }
      const missing = requiredFactCapabilities(facts).filter(value => !descriptor.factCapabilities?.includes(value));
      if (missing.length) reject('capability-missing', `目标运行时缺少项目所需能力：${missing.join('、')}`, {missing}, 'PROJECT_RUNTIME_INCOMPATIBLE');
    }
  }
  const snapshot = {schemaVersion: '1.0.0', hash: sha256(canonicalStringify(files))};
  if (expected && expected.hash !== snapshot.hash) reject('evidence-changed-after-plan', '计划后项目登记、身份或事实发生变化，请重新生成计划');
  return snapshot;
}
