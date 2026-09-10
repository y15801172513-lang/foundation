import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';

export const FOUNDATION_RUNTIME_DESCRIPTOR_SCHEMA_VERSION = '2.0.0';
export const FOUNDATION_BRIDGE_API_VERSION = '1.0.0';

const STATE_SOURCES = Object.freeze({
  installedStateSource: 'state/capabilities.json',
  activeStateSource: 'state/capabilities.json',
  registrationStateSource: 'state/capability-host-registrations.json',
});

function invalid(code, message, details = {}) {
  return new LifecycleError(code, message, {stage: 'runtime-descriptor', retryable: true, recovery: '修复当前 Foundation 安装或切换到 descriptor、endpoint 与 capability state 完整且健康的 current runtime；不要自动修复或激活', details});
}

function validRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function snapshotEndpoint(root, code) {
  const files = [];
  const directories = [];
  function visit(directory, relative = '') {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalid(code, `rule/capability endpoint 含符号链接或非目录：${relative || '.'}`);
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw invalid(code, `rule/capability endpoint 含符号链接：${child}`);
      if (entry.isDirectory()) { directories.push(child); visit(absolute, child); }
      else if (entry.isFile()) {
        const fileStat = fs.statSync(absolute);
        files.push({path: child, size: fileStat.size, sha256: sha256(fs.readFileSync(absolute)), mode: fileStat.mode & 0o777});
      } else throw invalid(code, `rule/capability endpoint 含不支持的文件类型：${child}`);
    }
  }
  visit(root);
  const inventory = {directories, files};
  return Object.freeze({...inventory, fileCount: files.length, byteLength: files.reduce((sum, entry) => sum + entry.size, 0), treeHash: sha256(canonicalStringify(inventory))});
}

function assertEndpointSchema(endpoint) {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint) || typeof endpoint.path !== 'string' || endpoint.type !== 'directory' || !Array.isArray(endpoint.directories) || !Array.isArray(endpoint.files) || !Number.isInteger(endpoint.fileCount) || !Number.isInteger(endpoint.byteLength) || !/^[0-9a-f]{64}$/u.test(endpoint.treeHash || '')) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor endpoint content identity contract 无效');
  if (endpoint.directories.some((entry) => !validRelative(entry)) || endpoint.files.some((entry) => !entry || !validRelative(entry.path) || !Number.isInteger(entry.size) || entry.size < 0 || !Number.isInteger(entry.mode) || !/^[0-9a-f]{64}$/u.test(entry.sha256 || ''))) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor endpoint inventory 无效');
  const inventory = {directories: endpoint.directories, files: endpoint.files};
  if (endpoint.fileCount !== endpoint.files.length || endpoint.byteLength !== endpoint.files.reduce((sum, entry) => sum + entry.size, 0) || endpoint.treeHash !== sha256(canonicalStringify(inventory))) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor endpoint inventory identity 不一致');
}

function assertCapabilityFacts(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || !Array.isArray(facts.bundled)) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor capabilityFacts 无效');
  for (const [key, expected] of Object.entries(STATE_SOURCES)) if (facts[key] !== expected) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', `runtime descriptor ${key} 不受当前 schema 支持`, {expected, actual: facts[key] || null});
  const ids = new Set();
  for (const entry of facts.bundled) {
    if (!entry || typeof entry.capabilityId !== 'string' || !entry.capabilityId || ids.has(entry.capabilityId) || typeof entry.type !== 'string' || typeof entry.version !== 'string' || !validRelative(entry.manifestPath)) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor bundled capability identity 或 manifestPath 无效');
    if (typeof entry.installed !== 'boolean' || typeof entry.active !== 'boolean' || typeof entry.projectScoped !== 'boolean') throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor bundled capability declaration 缺少 installed/active/projectScoped boolean');
    ids.add(entry.capabilityId);
  }
}

export function createFoundationRuntimeDescriptor({productVersion, platform, arch, buildIdentity, supportedProjectDataFormats, ruleCapabilityEndpoint = 'artifacts', ruleCapabilityEndpointRoot = null, capabilityFacts = {bundled: [], ...STATE_SOURCES}}) {
  if (typeof productVersion !== 'string' || !productVersion || typeof platform !== 'string' || !platform || typeof arch !== 'string' || !arch) throw invalid('RUNTIME_DESCRIPTOR_INPUT_INVALID', 'runtime descriptor 缺少 productVersion/platform/arch');
  if (!Array.isArray(supportedProjectDataFormats) || !supportedProjectDataFormats.length || supportedProjectDataFormats.some((value) => typeof value !== 'string' || !value)) throw invalid('RUNTIME_DESCRIPTOR_INPUT_INVALID', 'runtime descriptor 需要非空 supportedProjectDataFormats');
  if (!validRelative(ruleCapabilityEndpoint)) throw invalid('RUNTIME_DESCRIPTOR_INPUT_INVALID', 'rule/capability endpoint 必须是 app 内规范相对路径');
  if (typeof ruleCapabilityEndpointRoot !== 'string' || !path.isAbsolute(ruleCapabilityEndpointRoot) || !fs.existsSync(ruleCapabilityEndpointRoot)) throw invalid('RUNTIME_DESCRIPTOR_INPUT_INVALID', '创建 descriptor 必须提供当前 endpoint 的绝对普通目录用于绑定内容 identity');
  assertCapabilityFacts(capabilityFacts);
  const endpoint = snapshotEndpoint(ruleCapabilityEndpointRoot, 'RUNTIME_DESCRIPTOR_INPUT_INVALID');
  const payload = {
    schemaVersion: FOUNDATION_RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
    bridgeApiVersion: FOUNDATION_BRIDGE_API_VERSION,
    runtimeIdentity: {productVersion, platform, arch, buildIdentity: String(buildIdentity || 'uncommitted-local')},
    supportedProjectDataFormats: [...new Set(supportedProjectDataFormats)].sort(),
    ruleCapabilityEndpoint: {path: ruleCapabilityEndpoint, type: 'directory', ...endpoint},
    capabilityFacts: structuredClone(capabilityFacts),
  };
  const healthIdentity = sha256(canonicalStringify(payload));
  const bound = {...payload, healthIdentity};
  return Object.freeze({...bound, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(bound))}});
}

export function validateFoundationRuntimeDescriptor(document, {current = null} = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw invalid('RUNTIME_DESCRIPTOR_INVALID', 'runtime descriptor 不存在或不是 object');
  const {integrity, ...payload} = document;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(payload))) throw invalid('RUNTIME_DESCRIPTOR_TAMPERED', 'runtime descriptor integrity 不匹配');
  const {healthIdentity, ...healthPayload} = payload;
  if (payload.schemaVersion !== FOUNDATION_RUNTIME_DESCRIPTOR_SCHEMA_VERSION || payload.bridgeApiVersion !== FOUNDATION_BRIDGE_API_VERSION || healthIdentity !== sha256(canonicalStringify(healthPayload))) throw invalid('RUNTIME_DESCRIPTOR_HEALTH_IDENTITY_INVALID', 'runtime descriptor schema/API/health identity 无效');
  if (!Array.isArray(payload.supportedProjectDataFormats) || !payload.supportedProjectDataFormats.length || payload.supportedProjectDataFormats.some((entry) => typeof entry !== 'string' || !entry)) throw invalid('RUNTIME_DESCRIPTOR_SCHEMA_INVALID', 'runtime descriptor compatibility contract 无效');
  assertEndpointSchema(payload.ruleCapabilityEndpoint);
  assertCapabilityFacts(payload.capabilityFacts);
  if (current) {
    const identity = payload.runtimeIdentity || {};
    if (identity.productVersion !== current.version || identity.platform !== current.platform || identity.arch !== current.arch) throw invalid('RUNTIME_DESCRIPTOR_CURRENT_IDENTITY_MISMATCH', 'runtime descriptor 与 current installation identity 不匹配', {descriptor: identity, current: {version: current.version, platform: current.platform, arch: current.arch}});
  }
  return Object.freeze({...payload, integrity: Object.freeze({...integrity})});
}

function assertSafeContainedPath(root, relative, {missingCode, unsafeCode, expectedType, allowMissing = false}) {
  if (!validRelative(relative)) throw invalid(unsafeCode, `路径不是规范相对路径：${String(relative)}`);
  const target = path.resolve(root, ...relative.split('/'));
  const relation = path.relative(root, target);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw invalid(unsafeCode, `路径逃出受控根：${relative}`);
  let cursor = root;
  if (!fs.existsSync(cursor) || fs.lstatSync(cursor).isSymbolicLink() || !fs.statSync(cursor).isDirectory() || fs.realpathSync(cursor) !== cursor) throw invalid(unsafeCode, '受控根不是稳定普通目录');
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) {
      if (allowMissing) return target;
      throw invalid(missingCode, `路径缺失：${relative}`);
    }
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw invalid(unsafeCode, `路径祖先或目标是符号链接：${relative}`);
  }
  const stat = fs.statSync(target);
  if ((expectedType === 'directory' && !stat.isDirectory()) || (expectedType === 'file' && !stat.isFile()) || fs.realpathSync(target) !== target) throw invalid(unsafeCode, `路径类型或 realpath 无效：${relative}`);
  return target;
}

export function verifyFoundationRuntimeEndpoint({appRoot, descriptor}) {
  const endpoint = descriptor?.ruleCapabilityEndpoint;
  if (!endpoint || typeof endpoint.path !== 'string') throw invalid('RUNTIME_DESCRIPTOR_INVALID', 'descriptor 缺少 endpoint contract');
  const root = assertSafeContainedPath(appRoot, endpoint.path, {missingCode: 'RUNTIME_ENDPOINT_MISSING', unsafeCode: 'RUNTIME_ENDPOINT_UNSAFE', expectedType: 'directory'});
  const actual = snapshotEndpoint(root, 'RUNTIME_ENDPOINT_UNSAFE');
  const expected = {directories: endpoint.directories, files: endpoint.files, fileCount: endpoint.fileCount, byteLength: endpoint.byteLength, treeHash: endpoint.treeHash};
  if (canonicalStringify(actual) !== canonicalStringify(expected)) throw invalid('RUNTIME_ENDPOINT_IDENTITY_MISMATCH', '当前 rule/capability endpoint 内容、类型、大小、mode 或 tree identity 与 descriptor 不一致', {expectedTreeHash: endpoint.treeHash, actualTreeHash: actual.treeHash});
  return Object.freeze({path: root, relativePath: endpoint.path, type: 'directory', treeHash: actual.treeHash, fileCount: actual.fileCount, byteLength: actual.byteLength, verified: true});
}

export function resolveFoundationCapabilityStateSources({installationRoot, descriptor}) {
  const facts = descriptor?.capabilityFacts;
  assertCapabilityFacts(facts);
  const result = {};
  for (const [key, expected] of Object.entries(STATE_SOURCES)) {
    if (facts[key] !== expected) throw invalid('CAPABILITY_STATE_UNSAFE', `capability ${key} 未绑定 Foundation-owned state`, {expected, actual: facts[key] || null});
    result[key] = assertSafeContainedPath(installationRoot, facts[key], {missingCode: 'CAPABILITY_STATE_MISSING', unsafeCode: 'CAPABILITY_STATE_UNSAFE', expectedType: 'file', allowMissing: true});
  }
  return Object.freeze(result);
}

export function readFoundationRuntimeDescriptor(file, options = {}) {
  if (typeof file !== 'string' || !file) throw invalid('RUNTIME_DESCRIPTOR_PATH_INVALID', 'runtime descriptor path 无效');
  if (!fs.existsSync(file)) throw invalid('RUNTIME_DESCRIPTOR_MISSING', '当前 runtime 缺少 foundation-runtime-descriptor.json');
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw invalid('RUNTIME_DESCRIPTOR_TYPE_INVALID', 'runtime descriptor 必须是普通文件且不得为符号链接');
  let document;
  try { document = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw invalid('RUNTIME_DESCRIPTOR_PARSE_FAILED', 'runtime descriptor 不是有效 JSON'); }
  return validateFoundationRuntimeDescriptor(document, options);
}
