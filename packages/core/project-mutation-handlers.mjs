import {inspectContentIntegrity} from './content-integrity.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {isWithin, realProject, normalizePublicPath, normalizePreviewPath} from './path-boundary.mjs';
import {foundationUiPolicyRecord} from './ui-policy.mjs';
import {prepareProjectRulesAdoption} from './project-rules.mjs';
import {readFacts, validateFacts, inspectProjectPreparation} from './facts.mjs';
import {inspectEvidenceReport,verifySourceObservation} from './evidence-impact.mjs';
import {inspectReuseDecision,resolveAssetBinding,factMigrationImpact} from './asset-model.mjs';

export const CLOSED_PROJECT_HANDLER_VERSION = '1.0.0';
export const CLOSED_PROJECT_HANDLER_IDS = Object.freeze([
  'extension-shadcn-apply',
  'extension-shadcn-remove-owned',
  'foundation-facts-upgrade',
  'foundation-skeleton-and-facts-create',
  'relation-facts-write',
  'page-facts-write',
  'project-rules-adopt',
  'asset-facts-batch',
]);
const FACT_FILES = Object.freeze(['project', 'pages', 'relations', 'design-tokens', 'components', 'interactions', 'motions', 'changes', 'figma']);

function coded(code, message, details = {}) {
  return new LifecycleError(code, message, {stage: 'project-mutation-handler', details});
}

function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0') || relative.split('/').includes('..')) throw coded('PROJECT_HANDLER_PATH_INVALID', `内建 handler 路径无效：${relative}`);
  return relative;
}

function safeTarget(project, relative) {
  const root = realProject(project);
  const target = path.resolve(root, ...safeRelative(relative).split('/'));
  if (!isWithin(root, target)) throw coded('PROJECT_HANDLER_PATH_ESCAPE', `内建 handler 路径逃出项目：${relative}`);
  let cursor = root;
  for (const part of safeRelative(relative).split('/').slice(0, -1)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw coded('PROJECT_HANDLER_SYMLINK_REJECTED', `内建 handler 路径经过符号链接：${relative}`);
  }
  return target;
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', `${label} 必须是明确 ISO 时间`);
  return value;
}

function textField(draft, field, {required = false, max = 256} = {}) {
  const raw = draft[field];
  if (raw === undefined || raw === null) {
    if (required) throw coded('schema', `${field} 必填`);
    return null;
  }
  if (typeof raw !== 'string') throw coded('schema', `${field} 必须是字符串或 null`);
  const value = raw.trim();
  if (required && !value) throw coded('schema', `${field} 必填`);
  if (value.length > max) throw coded('schema', `${field} 超过 ${max} 字符`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw coded('schema', `${field} 不能包含控制字符`);
  return value || null;
}

export function normalizeRelationHandlerPayload(draft, {generatedAt = new Date().toISOString()} = {}) {
  const allowed = new Set(['from', 'to', 'trigger', 'condition', 'targetState', 'targetEntity', 'sourceHandle', 'targetHandle', 'expectedVersion']);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw coded('schema', '关系内容必须是对象');
  const unknown = Object.keys(draft).filter((field) => !allowed.has(field));
  if (unknown.length) throw coded('schema', `关系包含未知字段：${unknown.join('、')}`);
  const semantics = {
    from: textField(draft, 'from', {required: true, max: 128}),
    to: textField(draft, 'to', {required: true, max: 128}),
    trigger: textField(draft, 'trigger'),
    condition: textField(draft, 'condition', {max: 500}),
    targetState: textField(draft, 'targetState', {max: 128}),
    targetEntity: textField(draft, 'targetEntity', {max: 128}),
  };
  textField(draft, 'sourceHandle', {max: 128});
  textField(draft, 'targetHandle', {max: 128});
  const expectedVersion = textField(draft, 'expectedVersion', {max: 128});
  if (semantics.from === semantics.to && !(semantics.trigger && (semantics.targetState || semantics.targetEntity))) throw coded('schema', '页面自连必须声明触发语义及目标状态或目标实体');
  return {semantics, expectedVersion, generatedAt: iso(generatedAt, 'generatedAt')};
}

function normalizedExtensionPayload(payload, operation) {
  if (!payload || payload.adapter !== 'shadcn' || typeof payload.item !== 'string' || !/^[a-z0-9._-]+$/iu.test(payload.item) || !Array.isArray(payload.files) || !payload.files.length || typeof payload.planHash !== 'string') throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', 'extension handler payload 无效');
  const files = payload.files.map((file) => {
    safeRelative(file.path);
    const content = String(file.content);
    if (file.sha256 !== sha256(content)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', `extension 文件 hash 不匹配：${file.path}`);
    return {path: file.path, content, sha256: file.sha256};
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map((file) => file.path)).size !== files.length) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', 'extension 文件路径重复');
  const seed = {schemaVersion: '1.0.0', adapter: payload.adapter, project: payload.project, installationRoot: payload.installationRoot, source: payload.source, item: payload.item, version: payload.version ?? null, license: payload.license ?? null, ownership: 'project-owned', files};
  if (sha256(canonicalStringify(seed)) !== payload.planHash) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', 'extension handler payload 与 planHash 不匹配');
  return {...seed, planHash: payload.planHash, appliedAt: iso(payload.appliedAt, 'appliedAt'), operation};
}

function normalizedUpgradePayload(payload) {
  if (!payload || payload.from !== '0.1.0' || payload.to !== '0.1.1' || !/^[0-9a-f]{64}$/u.test(payload.foundationHash || '') || !/^\.foundation\/backups\/pre-upgrade-[0-9a-f]{24}$/u.test(payload.backupRelative || '')) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', 'upgrade handler payload 无效');
  iso(payload.updatedAt, 'updatedAt');
  const seed = {schemaVersion: '1.0.0', operation: 'foundation-facts-upgrade', project: payload.project, from: payload.from, to: payload.to, foundationHash: payload.foundationHash, createdAt: payload.createdAt};
  if (sha256(canonicalStringify(seed)) !== payload.payloadHash || payload.backupRelative !== `.foundation/backups/pre-upgrade-${payload.payloadHash.slice(0, 24)}`) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', 'upgrade payload hash 或 backup path 不匹配');
  return {...payload};
}

function normalize(operation, project, payload) {
  const root = realProject(project);
  if (operation === 'asset-facts-batch') return normalizeAssetBatch(root, payload);
  if (operation === 'project-rules-adopt') {
    iso(payload?.generatedAt, 'generatedAt');
    const prepared = prepareProjectRulesAdoption(root, payload);
    const writes = prepared.files.map(file => file.path).sort();
    return {handlerId: operation, payload: {...payload}, allowedWriteSet: writes, actions: [{action: operation, files: prepared.files.map(file => ({path: file.path, sha256: sha256(file.content), bytes: Buffer.byteLength(file.content)})), currentIdentityHash: prepared.currentIdentityHash, endpointIdentity: prepared.endpointIdentity, governanceMode: prepared.adoption.governanceMode, hostDiscoveryVerified: false}], creates: writes.filter(relative => !fs.existsSync(safeTarget(root, relative))), changes: writes.filter(relative => fs.existsSync(safeTarget(root, relative))), deletes: []};
  }
  if (operation === 'page-facts-write') {
    const draft = payload?.draft;
    const allowed = ['id', 'name', 'route', 'description', 'expectedVersion'];
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).some((key) => !allowed.includes(key))) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '页面内容仅支持 id/name/route/description/expectedVersion');
    const normalized = {id: textField(draft, 'id', {max: 128}), name: textField(draft, 'name', {required: true}), route: textField(draft, 'route', {required: true, max: 512}), description: textField(draft, 'description', {max: 2000}), expectedVersion: textField(draft, 'expectedVersion', {max: 128})};
    if (!normalized.route.startsWith('/') || normalized.route.startsWith('//') || /\s/u.test(normalized.route)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '页面 route 必须是本地应用路径，不可使用远程 URL');
    const pages = JSON.parse(fs.readFileSync(safeTarget(root, '.foundation/facts/pages.json'), 'utf8'));
    const id = normalized.id || stableId('page', normalized.route);
    const existing = pages.items?.find((item) => item.id === id);
    const declaration = !existing || (existing.runtimeBinding === 'unbound' && existing.preview === `/__foundation/declarations/${id}`);
    const writes = ['.foundation/facts/pages.json', ...(declaration ? ['.foundation/preview.json', `.foundation/generated-cache/page-declarations/${id}.html`] : [])].sort();
    for (const relative of writes) safeRelative(relative);
    return {handlerId: operation, payload: {draft: normalized, generatedAt: iso(payload.generatedAt || new Date().toISOString(), 'generatedAt')}, allowedWriteSet: writes, actions: writes.map((relative) => `write:${relative}`), creates: writes.filter((relative) => !fs.existsSync(safeTarget(root, relative))), changes: writes.filter((relative) => fs.existsSync(safeTarget(root, relative))), deletes: []};
  }
  if (operation === 'foundation-skeleton-and-facts-create') {
    if (!payload || Object.keys(payload).some(key => !['generatedAt', 'includePreview'].includes(key)) || (payload.includePreview !== undefined && typeof payload.includePreview !== 'boolean')) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '准备操作仅支持 generatedAt 与明确的 includePreview');
    const generatedAt = iso(payload?.generatedAt, 'generatedAt');
    const preparation = inspectProjectPreparation(root);
    const includePreview = payload.includePreview ?? true;
    if (preparation.state === 'blocked' || preparation.preview.state === 'invalid' || (includePreview && preparation.preview.state === 'unsupported')) throw coded('PROJECT_PREPARATION_CONFLICT', [...preparation.errors, preparation.preview.message].filter(Boolean).join('；'));
    const allowedWriteSet = [...preparation.missing, ...(includePreview && preparation.preview.state === 'absent' ? ['.foundation/preview.json'] : [])].sort();
    const documents = skeletonDocuments(root, {generatedAt,includePreview}).filter(file=>allowedWriteSet.includes(file.path));
    return {handlerId: operation, payload: {generatedAt, includePreview}, allowedWriteSet, actions: [...allowedWriteSet.map((entry) => `create-if-absent:${entry}`), {action:operation,files:documents.map(file=>({path:file.path,sha256:sha256(file.content),bytes:Buffer.byteLength(file.content)}))}], documents, creates: allowedWriteSet, changes: [], deletes: []};
  }
  if (operation === 'relation-facts-write') {
    const draft = payload?.draft || (payload?.semantics ? {...payload.semantics, expectedVersion: payload.expectedVersion} : null);
    const normalized = normalizeRelationHandlerPayload(draft, {generatedAt: payload?.generatedAt});
    return {handlerId: operation, payload: normalized, allowedWriteSet: ['.foundation/facts/relations.json'], actions: ['write:.foundation/facts/relations.json'], creates: [], changes: ['.foundation/facts/relations.json'], deletes: []};
  }
  if (operation === 'extension-shadcn-apply' || operation === 'extension-shadcn-remove-owned') {
    const normalized = normalizedExtensionPayload(payload, operation);
    const receipt = `.foundation/extensions/shadcn-${normalized.item}.json`;
    const allowedWriteSet = operation.endsWith('-apply') ? [...normalized.files.map((file) => file.path), receipt].sort() : normalized.files.map((file) => file.path).sort();
    return {handlerId: operation, payload: normalized, allowedWriteSet, actions: allowedWriteSet.map((entry) => `${operation.endsWith('-apply') ? 'write' : 'remove-owned'}:${entry}`), creates: operation.endsWith('-apply') ? allowedWriteSet : [], changes: [], deletes: operation.endsWith('-apply') ? [] : allowedWriteSet};
  }
  if (operation === 'foundation-facts-upgrade') {
    const normalized = normalizedUpgradePayload(payload);
    const identityRelative = fs.existsSync(path.join(root, '.foundation', 'identity', 'project.json')) ? '.foundation/identity/project.json' : '.foundation/foundation.json';
    const allowedWriteSet = [identityRelative, normalized.backupRelative].sort();
    return {handlerId: operation, payload: normalized, allowedWriteSet, actions: [`backup:${normalized.backupRelative}`, `write:${identityRelative}`], creates: [normalized.backupRelative], changes: [identityRelative], deletes: []};
  }
  throw coded('PROJECT_HANDLER_UNKNOWN', `没有 Foundation-owned closed handler：${operation}`);
}

function snapshotPath(project, relative) {
  const target = safeTarget(project, relative);
  if (!fs.existsSync(target)) return {path: relative, exists: false};
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw coded('PROJECT_HANDLER_SYMLINK_REJECTED', `写集合目标不得为符号链接：${relative}`);
  if (stat.isFile()) return {path: relative, exists: true, kind: 'file', mode: stat.mode & 0o777, sha256: sha256(fs.readFileSync(target)), contentBase64: fs.readFileSync(target).toString('base64')};
  if (!stat.isDirectory()) throw coded('PROJECT_HANDLER_PATH_INVALID', `写集合目标类型无效：${relative}`);
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const nested = path.relative(target, absolute).replaceAll(path.sep, '/');
      if (entry.isSymbolicLink()) throw coded('PROJECT_HANDLER_SYMLINK_REJECTED', `写集合目录包含符号链接：${relative}/${nested}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) entries.push({path: nested, mode: fs.statSync(absolute).mode & 0o777, contentBase64: fs.readFileSync(absolute).toString('base64'), sha256: sha256(fs.readFileSync(absolute))});
      else throw coded('PROJECT_HANDLER_PATH_INVALID', `写集合目录包含特殊文件：${relative}/${nested}`);
    }
  };
  visit(target);
  return {path: relative, exists: true, kind: 'directory', mode: stat.mode & 0o777, entries};
}

export function snapshotClosedHandlerWrites(project, allowedWriteSet) {
  const snapshots = [...allowedWriteSet].sort().map((relative) => snapshotPath(project, relative));
  return {snapshots, hash: sha256(canonicalStringify(snapshots))};
}

export function deriveClosedHandlerBinding({operation, project, handlerPayload}) {
  const definition = normalize(operation, project, handlerPayload);
  const before = snapshotClosedHandlerWrites(project, definition.allowedWriteSet);
  const payloadHash = sha256(canonicalStringify(definition.payload));
  return Object.freeze({handlerId: definition.handlerId, handlerVersion: CLOSED_PROJECT_HANDLER_VERSION, payload: definition.payload, payloadHash, allowedWriteSet: definition.allowedWriteSet, beforeStateHash: before.hash, actions: definition.actions, creates: definition.creates, changes: definition.changes, deletes: definition.deletes});
}

export function assertClosedHandlerBinding(plan) {
  if (plan.operation === 'project-rules-adopt' && plan.handler?.payload?.installationRoot !== plan.installationRoot) throw coded('PROJECT_HANDLER_BINDING_MISMATCH', '规则采用必须绑定同一安装');
  const derived = deriveClosedHandlerBinding({operation: plan.operation, project: plan.project, handlerPayload: plan.handler?.payload});
  for (const field of ['handlerId', 'handlerVersion', 'payloadHash', 'beforeStateHash']) if (plan.handler?.[field] !== derived[field]) throw coded('PROJECT_HANDLER_BINDING_MISMATCH', `project handler ${field} 与当前内建实现/写前状态不匹配`);
  if (canonicalStringify(plan.handler.allowedWriteSet) !== canonicalStringify(derived.allowedWriteSet) || canonicalStringify(plan.actions) !== canonicalStringify(derived.actions) || canonicalStringify(plan.creates) !== canonicalStringify(derived.creates) || canonicalStringify(plan.changes) !== canonicalStringify(derived.changes) || canonicalStringify(plan.deletes) !== canonicalStringify(derived.deletes)) throw coded('PROJECT_HANDLER_WRITE_SET_MISMATCH', 'project handler 写集合或 action effect 不匹配');
  return derived;
}

function writeAtomic(file, content, mode = undefined) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content, {flag: 'wx', ...(mode === undefined ? {} : {mode})});
  fs.renameSync(temporary, file);
}

function normalizeAssetBatch(project, payload) {
  payload = structuredClone(payload);
  const kinds = ['pages', 'components', 'interactions', 'motions', 'changes', 'design-tokens', 'relations'];
  if (!payload || Object.keys(payload).some(key => !['documents', 'sources', 'scope', 'generatedAt', 'preview','analysis'].includes(key)) || !Array.isArray(payload.documents) || !payload.documents.length || payload.documents.length > kinds.length || !Array.isArray(payload.sources) || typeof payload.scope !== 'string' || !payload.scope.trim() || payload.scope.length > 2000) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '资产批次需 documents、sources、精确 scope 和 generatedAt');
  iso(payload.generatedAt, 'generatedAt');
  const seen = new Set();
  const sources = payload.sources.map(source => {
    if (!source || Object.keys(source).some(key => !['path', 'sha256'].includes(key)) || !/^[a-f0-9]{64}$/u.test(source.sha256 || '')) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '源码证据需精确相对路径和 SHA-256');
    const target = safeTarget(project, source.path);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(target)) !== source.sha256) throw coded('PROJECT_HANDLER_SOURCE_CHANGED', `源码证据失效：${source.path}`);
    if (seen.has(source.path)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '源码证据路径重复');
    seen.add(source.path);
    return {...source};
  });
  for (const kind of FACT_FILES) {
    const file = safeTarget(project, `.foundation/facts/${kind}.json`);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw coded('PROJECT_HANDLER_SYMLINK_REJECTED', '事实输入必须为普通文件');
  }
  const facts = readFacts(project);
  const migrationBefore=structuredClone(facts);
  const changedKinds = new Set();
  const documents = payload.documents.map(document => {
    if (!document || Object.keys(document).some(key => !['kind', 'expectedSha256', 'upserts', 'removes'].includes(key)) || !kinds.includes(document.kind) || changedKinds.has(document.kind) || !Array.isArray(document.upserts) || (!document.upserts.length && !document.removes?.length) || (document.removes !== undefined && !Array.isArray(document.removes))) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '资产文档类型、重复项或 upserts/removes 无效');
    changedKinds.add(document.kind);
    const relative = `.foundation/facts/${document.kind}.json`;
    const target = safeTarget(project, relative);
    if (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink() || sha256(fs.readFileSync(target)) !== document.expectedSha256) throw coded('PROJECT_HANDLER_BEFORE_STATE_CHANGED', `资产文档已变化：${relative}`);
    const ids = new Set();
    const existing = facts[document.kind];
    const removes = document.removes || [];
    if (new Set(removes).size !== removes.length || removes.some(id => typeof id !== 'string' || !existing.items.some(item => item.id === id) || document.upserts.some(item => item.id === id))) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '移除项必须精确存在且不能同时 upsert；不删除源码');
    const items = existing.items.filter(item => !removes.includes(item.id));
    for (const item of document.upserts) {
      if(item?.assetModel?.binding?.file) {
        if(item.implementationMapping && item.implementationMapping!==item.assetModel.binding.file)throw coded('PROJECT_HANDLER_PAYLOAD_INVALID','声明绑定与实现路径冲突');
        item.implementationMapping=item.assetModel.binding.file;
      }
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(item.id) || ids.has(item.id) || typeof item.implementationMapping !== 'string' || !seen.has(item.implementationMapping)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '每项资产需唯一 ID 及绑定实际源码证据的 implementationMapping');
      ids.add(item.id);
      if (!['unverified', 'verified'].includes(item.verificationStatus)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '资产验证状态必须明确');
      if (item.verificationStatus === 'verified' && (typeof item.verificationEvidence !== 'string' || !seen.has(item.verificationEvidence))) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '已验证资产需绑定实际验证证据文件；文件摘要不等于真人验收');
      for (const requirement of item.deliveryScope?.items || []) if (['content','mapping','runtime'].some(field => requirement[field] === 'verified') && !seen.has(requirement.evidence)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '任务范围已验证项需绑定实际证据文件');
      for(const evidence of item.evidenceIndex || []) {
        if(!seen.has(evidence.report?.path) || sources.find(s=>s.path===evidence.report.path)?.sha256!==evidence.report.sha256)throw coded('PROJECT_HANDLER_PAYLOAD_INVALID','证据报告必须绑定本次精确 sources');
        const checked=inspectEvidenceReport({project,evidence});
        if(checked.state==='invalid' || item.verificationStatus==='verified' && checked.state!=='verified')throw coded('PROJECT_HANDLER_PAYLOAD_INVALID',checked.reason || '未经独立核验的报告不能标记 verified');
      }
      const index = items.findIndex(existingItem => existingItem.id === item.id);
      const next = {...(index < 0 ? {} : items[index]), ...item, implementationSha256: sources.find(source => source.path === item.implementationMapping).sha256, updatedAt: payload.generatedAt};
      if (index < 0) items.push(next); else items[index] = next;
    }
    facts[document.kind] = {...existing, items};
    return {path: relative, content: `${JSON.stringify(facts[document.kind], null, 2)}\n`};
  });
  const previewFile = safeTarget(project, '.foundation/preview.json');
  let preview;
  // Only preview-changing batches consume this optional configuration. Asset
  // maintenance neither converts nor rewrites a project's existing preview.
  if (payload.preview) {
    if (!fs.existsSync(previewFile)) throw coded('PROJECT_PREVIEW_PREPARATION_REQUIRED', '尚无预览配置；先单独确认预览准备，事实维护无需预览');
    if (!fs.lstatSync(previewFile).isFile() || fs.lstatSync(previewFile).isSymbolicLink()) throw coded('PROJECT_HANDLER_SYMLINK_REJECTED', '预览配置必须为普通文件');
    preview = JSON.parse(fs.readFileSync(previewFile, 'utf8'));
    if (preview.schemaVersion !== '0.1.0' || preview.mode !== 'local-static' || !Array.isArray(preview.routes) || !Array.isArray(preview.assets)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '不支持现有预览配置；不覆盖');
    const proposal = payload.preview;
    if (Object.keys(proposal).some(key => !['expectedSha256', 'routes', 'assets', 'removeRoutes', 'removeAssets'].includes(key)) || sha256(fs.readFileSync(previewFile)) !== proposal.expectedSha256) throw coded('PROJECT_HANDLER_BEFORE_STATE_CHANGED', '预览映射写前摘要不匹配');
    preview = structuredClone(preview);
    for (const kind of ['routes', 'assets']) {
      const removes = proposal[kind === 'routes' ? 'removeRoutes' : 'removeAssets'] || [];
      if (!Array.isArray(removes) || new Set(removes).size !== removes.length || removes.some(value => !preview[kind].some(item => item.path === value) || proposal[kind]?.some(item => item.path === value))) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '移除的预览路径必须精确存在且不与本次写入重复');
      preview[kind] = preview[kind].filter(item => !removes.includes(item.path));
      if (!Array.isArray(proposal[kind])) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '预览映射需 routes 和 assets 数组');
      const paths = new Set();
      for (const entry of proposal[kind]) {
        if (!entry || Object.keys(entry).some(key => !['path', 'file'].includes(key)) || !seen.has(entry.file) || paths.has(entry.path)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '每个预览映射需唯一公开路径及绑定的实际源码文件');
        entry.path = normalizePreviewPath(entry.path, '批次预览路径'); paths.add(entry.path);
        const index = preview[kind].findIndex(item => item.path === entry.path);
        if (index < 0) preview[kind].push({...entry}); else preview[kind][index] = {...preview[kind][index], ...entry};
      }
    }
    const paths = [...preview.routes, ...preview.assets].map(item => normalizePreviewPath(item.path, '批次预览路径'));
    if (new Set(paths).size !== paths.length) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '预览路由与资源路径重复');
    documents.push({path: '.foundation/preview.json', content: `${JSON.stringify(preview, null, 2)}\n`});
  }
  const validation = validateFacts(facts, {projectRoot: project, previewConfig: preview});
  if (validation.length) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', `资产批次引用或格式无效：${validation.join('；')}`);
  const decisions=payload.documents.flatMap(document=>document.kind==='changes'?document.upserts.flatMap(item=>item.reuseDecisions || []):[]);
  const reuseInspection=[];
  if(decisions.length || payload.analysis) {
    let before,after;
    try{before=verifySourceObservation({project,observation:payload.analysis?.before});after=verifySourceObservation({project,observation:payload.analysis?.after,current:true});}
    catch(error){throw coded('PROJECT_HANDLER_ANALYSIS_INVALID',error.message);}
    for(const decision of decisions){const inspected=inspectReuseDecision(decision,before,after);reuseInspection.push(inspected);if(inspected.state==='decision-not-applied')throw coded('PROJECT_HANDLER_DECISION_NOT_APPLIED',inspected.issues.map(issue=>issue.message).join('；'));}
    const bindings=resolveAssetBinding(facts,after);
    if(bindings.some(binding=>binding.state==='conflict'||binding.state==='unresolved'))throw coded('PROJECT_HANDLER_DEFINITION_UNRESOLVED','当前定义绑定未能对应受控分析观察；保留候选，先解决声明身份');
  }
  const writes = documents.map(document => document.path).sort();
  return {handlerId: 'asset-facts-batch', payload: structuredClone(payload), allowedWriteSet: writes, actions: [{action: 'asset-facts-batch', scope: payload.scope, sources, documents: documents.map(document => ({path: document.path, beforeSha256:sha256(fs.readFileSync(safeTarget(project,document.path))),sha256: sha256(document.content), bytes: Buffer.byteLength(document.content)})), migration:factMigrationImpact(migrationBefore,facts),recovery:'existing-exact-transaction-preimages; stop-on-drift',reuseInspection,contentIntegrity: inspectContentIntegrity(facts, {requireCoverage: true}), semanticVerification: 'recorded-evidence-not-human-acceptance'}], creates: [], changes: writes, deletes: [], documents};
}

function stableId(type, key) {
  return `${type}_${sha256(`${type}:${key}`).slice(0, 12)}`;
}

function skeletonDocuments(project, payload) {
  const identity={schemaVersion:'1.0.0',layoutVersion:'2.0.0',projectId:stableId('project',path.basename(project)),identityScheme:'foundation-project-id-v2',name:path.basename(project),projectKind:'existing',governanceMode:'preserve-and-inventory',uiPolicy:foundationUiPolicyRecord('existing'),dataFormatVersion:'0.1.0',createdAt:payload.generatedAt,updatedAt:payload.generatedAt};
  return [{path:'.foundation/identity/project.json',content:JSON.stringify(identity,null,2)},...FACT_FILES.map(kind=>({path:`.foundation/facts/${kind}.json`,content:JSON.stringify({schemaVersion:'0.1.0',items:[],kind},null,2)})),...(payload.includePreview?[{path:'.foundation/preview.json',content:JSON.stringify({schemaVersion:'0.1.0',mode:'local-static',routes:[],assets:[]},null,2)+'\n'}]:[])];
}
function executeSkeleton(project, payload) {
  const prepared=normalize('foundation-skeleton-and-facts-create',project,payload);
  const root=path.join(project,'.foundation');
  for(const directory of ['identity','facts','generated-cache/management-center','backups'])fs.mkdirSync(path.join(root,directory),{recursive:true});
  for(const file of prepared.documents)fs.writeFileSync(safeTarget(project,file.path),file.content,{flag:'wx'});
  return root;
}

function executeRelation(project, payload) {
  const relationsFile = safeTarget(project, '.foundation/facts/relations.json');
  const pagesFile = safeTarget(project, '.foundation/facts/pages.json');
  const relations = JSON.parse(fs.readFileSync(relationsFile, 'utf8'));
  const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
  const currentVersion = sha256(JSON.stringify(relations)).slice(0, 16);
  if (payload.expectedVersion && payload.expectedVersion !== currentVersion) { const error = coded('version_conflict', '关系事实已更新，请刷新后重试'); error.currentVersion = currentVersion; throw error; }
  const {semantics} = payload;
  if (!(pages.items || []).some((page) => page.id === semantics.from) || !(pages.items || []).some((page) => page.id === semantics.to)) throw coded('schema', '关系引用了未登记页面');
  const same = (item) => Object.entries(semantics).every(([field, value]) => (item[field] ?? null) === value);
  if ((relations.items || []).some(same)) throw coded('duplicate', '完全相同的关系已登记');
  const id = stableId('relation', JSON.stringify(semantics));
  const relation = {id, from: semantics.from, to: semantics.to, trigger: semantics.trigger, condition: semantics.condition, ...(semantics.targetState ? {targetState: semantics.targetState} : {}), ...(semantics.targetEntity ? {targetEntity: semantics.targetEntity} : {}), sourceHandle: `relation:${id}:source`, targetHandle: `relation:${id}:target`, status: 'registered', source: 'management-center', updatedAt: payload.generatedAt, verificationStatus: 'unverified', runtimeBinding: semantics.trigger ? 'pending' : 'unbound'};
  const next = {...relations, items: [...(relations.items || []), relation]};
  writeAtomic(relationsFile, `${JSON.stringify(next, null, 2)}\n`);
  return relation;
}

function executePage(project, payload) {
  const file = safeTarget(project, '.foundation/facts/pages.json');
  const pages = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(pages.items)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', '页面事实格式无效；不覆盖既有内容');
  const version = sha256(JSON.stringify(pages)).slice(0, 16);
  const draft = payload.draft;
  if (draft.expectedVersion && draft.expectedVersion !== version) throw coded('version_conflict', '页面事实已更新，请刷新后重试');
  const id = draft.id || stableId('page', draft.route);
  const existing = pages.items.find((item) => item.id === id);
  if (existing && (!draft.id || !draft.expectedVersion)) throw coded('duplicate', '页面已登记；修改必须指定实际页面及当前版本');
  if (draft.id && !existing) throw coded('page_not_found', '待修改页面不存在；不要用未知 ID 创建页面');
  if (pages.items.some((item) => item.id !== id && item.route === draft.route)) throw coded('duplicate', '该路由已有页面，不能覆盖或重复登记');
  const next = {...(existing || {id, entry: pages.items.length === 0, status: 'registered', source: 'codex-conversation', verificationStatus: 'unverified', runtimeBinding: 'unbound', preview: `/__foundation/declarations/${id}`}), name: draft.name, route: draft.route, ...(draft.description !== null ? {description: draft.description} : {}), updatedAt: payload.generatedAt};
  if (!existing || (existing.runtimeBinding === 'unbound' && existing.preview === `/__foundation/declarations/${id}`)) {
    const relative = `.foundation/generated-cache/page-declarations/${id}.html`;
    const target = safeTarget(project, relative);
    const html = (page) => {
      const escape = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(page.name)} — 页面登记</title><body><h1>${escape(page.name)}</h1><p><strong>仅登记，尚未绑定或验证业务实现。</strong></p><p>目标路由：${escape(page.route)}</p><p>${escape(page.description)}</p><p>这是 Foundation 从事实生成的展示页，不是示例业务页面，也不证明功能已经实现。</p></body></html>\n`;
    };
    if (fs.existsSync(target) && (!existing || fs.readFileSync(target, 'utf8') !== html(existing))) throw coded('PAGE_DECLARATION_MODIFIED', '页面展示文件包含未知或用户修改内容；保留，不覆盖');
    const previewFile = safeTarget(project, '.foundation/preview.json');
    const preview = JSON.parse(fs.readFileSync(previewFile, 'utf8'));
    if (!Array.isArray(preview.routes)) throw coded('PROJECT_HANDLER_PAYLOAD_INVALID', 'preview 路由格式无效');
    const match = preview.routes.find((route) => route.path === next.preview);
    if (match && match.file !== relative) throw coded('PAGE_DECLARATION_CONFLICT', '声明展示路由已被其他文件占用；不覆盖');
    fs.mkdirSync(path.dirname(target), {recursive: true});
    writeAtomic(target, html(next));
    if (!match) writeAtomic(previewFile, `${JSON.stringify({...preview, routes: [...preview.routes, {path: next.preview, file: relative}]}, null, 2)}\n`);
  }
  const items = existing ? pages.items.map((item) => item.id === id ? next : item) : [...pages.items, next];
  writeAtomic(file, `${JSON.stringify({...pages, items}, null, 2)}\n`);
  return {page: next, version: sha256(JSON.stringify({...pages, items})).slice(0, 16), runtimeVerified: false};
}

function executeExtension(project, payload, remove) {
  if (remove) {
    const modified = payload.files.filter((file) => !fs.existsSync(safeTarget(project, file.path)) || sha256(fs.readFileSync(safeTarget(project, file.path))) !== file.sha256).map((file) => file.path);
    if (modified.length) return {ok: false, preservedModified: modified};
    for (const file of payload.files) fs.rmSync(safeTarget(project, file.path));
    return {ok: true, removed: payload.files.map((file) => file.path)};
  }
  for (const file of payload.files) {
    const target = safeTarget(project, file.path);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== file.sha256) throw coded('EXTENSION_TARGET_CONFLICT', `目标文件已存在且内容不同：${file.path}`);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, file.content);
  }
  const receiptRelative = `.foundation/extensions/shadcn-${payload.item}.json`;
  const receiptFile = safeTarget(project, receiptRelative);
  fs.mkdirSync(path.dirname(receiptFile), {recursive: true});
  fs.writeFileSync(receiptFile, `${JSON.stringify({...payload, appliedAt: payload.appliedAt}, null, 2)}\n`);
  return {ok: true, receiptFile, files: payload.files.map((file) => file.path), ownership: 'project-owned'};
}

function copyTree(source, destination, skip = []) {
  fs.mkdirSync(destination, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (skip.includes(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw coded('PROJECT_HANDLER_SYMLINK_REJECTED', `upgrade source 含符号链接：${from}`);
    if (entry.isDirectory()) copyTree(from, to, skip);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw coded('PROJECT_HANDLER_PATH_INVALID', `upgrade source 含特殊文件：${from}`);
  }
}

function executeUpgrade(project, payload) {
  const foundationRelative = fs.existsSync(safeTarget(project, '.foundation/identity/project.json')) ? '.foundation/identity/project.json' : '.foundation/foundation.json';
  const foundationRoot = safeTarget(project, foundationRelative);
  if (sha256(fs.readFileSync(foundationRoot)) !== payload.foundationHash) throw coded('PROJECT_HANDLER_BEFORE_STATE_CHANGED', 'upgrade plan 后 foundation.json 已变化');
  const foundation = JSON.parse(fs.readFileSync(foundationRoot));
  if (foundation.dataFormatVersion !== payload.from) throw coded('PROJECT_HANDLER_BEFORE_STATE_CHANGED', 'upgrade 前版本已变化');
  const backup = safeTarget(project, payload.backupRelative);
  copyTree(path.join(project, '.foundation'), backup, ['backups']);
  foundation.dataFormatVersion = payload.to;
  foundation.updatedAt = payload.updatedAt;
  writeAtomic(foundationRoot, `${JSON.stringify(foundation, null, 2)}\n`);
  return {target: project, from: payload.from, to: payload.to, backup};
}

export function executeClosedProjectHandler(plan) {
  const binding = assertClosedHandlerBinding(plan);
  if (binding.handlerId === 'asset-facts-batch') {
    const prepared = normalizeAssetBatch(plan.project, binding.payload);
    for (const document of prepared.documents) {
      const target = safeTarget(plan.project,document.path);
      const expected = document.path === '.foundation/preview.json' ? binding.payload.preview.expectedSha256 : binding.payload.documents.find(item=>document.path === `.foundation/facts/${item.kind}.json`).expectedSha256;
      if (sha256(fs.readFileSync(target)) !== expected) throw coded('PROJECT_HANDLER_BEFORE_STATE_CHANGED','提交时事实发生变化，保留未知修改');
      writeAtomic(target, document.content);
    }
    return {ok: true, changed: prepared.allowedWriteSet, scope: binding.payload.scope, preserved: ['unmentioned-records', 'project-code', 'user-data'], verification: 'evidence-linked-not-human-acceptance'};
  }
  if (binding.handlerId === 'project-rules-adopt') {
    const prepared = prepareProjectRulesAdoption(plan.project, binding.payload);
    for (const file of prepared.files) {
      const target = safeTarget(plan.project, file.path);
      writeAtomic(target, file.content, fs.existsSync(target) ? fs.lstatSync(target).mode & 0o777 : 0o644);
    }
    return {ok: true, adoption: prepared.adoption, changed: prepared.files.map(file => file.path), preserved: ['existing-AGENTS-content', 'project-code', 'project-facts'], hostDiscoveryVerified: false};
  }
  if (binding.handlerId === 'foundation-skeleton-and-facts-create') return executeSkeleton(plan.project, binding.payload);
  if (binding.handlerId === 'relation-facts-write') return executeRelation(plan.project, binding.payload);
  if (binding.handlerId === 'page-facts-write') return executePage(plan.project, binding.payload);
  if (binding.handlerId === 'extension-shadcn-apply') return executeExtension(plan.project, binding.payload, false);
  if (binding.handlerId === 'extension-shadcn-remove-owned') return executeExtension(plan.project, binding.payload, true);
  if (binding.handlerId === 'foundation-facts-upgrade') return executeUpgrade(plan.project, binding.payload);
  throw coded('PROJECT_HANDLER_UNKNOWN', `没有可执行的 closed handler：${binding.handlerId}`);
}

export function restoreClosedHandlerWrites(project, snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    const target = safeTarget(project, snapshot.path);
    if (fs.existsSync(target)) fs.rmSync(target, {recursive: true, force: true});
    if (!snapshot.exists) continue;
    if (snapshot.kind === 'file') {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, Buffer.from(snapshot.contentBase64, 'base64'), {mode: snapshot.mode});
    } else {
      fs.mkdirSync(target, {recursive: true, mode: snapshot.mode});
      for (const entry of snapshot.entries) {
        const file = path.join(target, ...entry.path.split('/'));
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, Buffer.from(entry.contentBase64, 'base64'), {mode: entry.mode});
      }
    }
  }
}

export function closedProjectHandlerCatalog() {
  return Object.freeze([
    'foundation-skeleton-and-facts-create',
    'relation-facts-write',
    'page-facts-write',
    'project-rules-adopt',
    'asset-facts-batch',
    'extension-shadcn-apply',
    'extension-shadcn-remove-owned',
    'foundation-facts-upgrade',
  ]);
}
