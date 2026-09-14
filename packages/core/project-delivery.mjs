import fs from 'node:fs';
import path from 'node:path';
import {sha256} from './install-contract.mjs';
import {realProject} from './path-boundary.mjs';
import {FACT_FILES, readFacts, validateFacts, inspectProjectPreparation} from './facts.mjs';
import {readCurrentFoundationRules} from './rules-delivery.mjs';

// Read-only projection. Neither the supplied change list nor a passing result
// grants mutation authority. Facts retain the verified source digest; no second
// delivery database or remembered success flag is maintained.
function fileAt(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative)) throw new Error('交付检查需要精确项目相对文件路径');
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`拒绝符号链接：${relative}`); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  if (!fs.lstatSync(cursor).isFile()) throw new Error(`不是普通文件：${relative}`);
  return cursor;
}

export function inspectProjectDeliveryFiles({project, changes = [], requirePreview = false} = {}) {
  const root = realProject(project);
  if (!Array.isArray(changes) || typeof requirePreview !== 'boolean') throw new Error('交付检查变化必须为数组，预览要求必须为布尔值');
  const seen = new Set();
  for (const change of changes) {
    if (!change || Object.keys(change).some(key => !['path', 'sha256'].includes(key)) || seen.has(change.path) || !(change.sha256 === null || /^[a-f0-9]{64}$/u.test(change.sha256 || ''))) throw new Error('变化需唯一 path 和当前 SHA-256；删除使用 null');
    fileAt(root, change.path); seen.add(change.path);
  }
  const preparation = inspectProjectPreparation(root), issues = [];
  if (!preparation.factsReady) return {schemaVersion: '1.0.0', state: 'sync-pending', summary: '代码完成情况未核实，Foundation同步待完成', project: root, preparation, issues: preparation.errors, changes, mutationPerformed: false};
  for (const kind of FACT_FILES) fileAt(root, `.foundation/facts/${kind}.json`);
  const facts = readFacts(root);
  const assets = FACT_FILES.flatMap(kind => facts[kind].items.map(item => ({kind, ...item})));
  let preview = null;
  try {
    const file = fileAt(root, '.foundation/preview.json');
    if (file) preview = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { issues.push({code: 'PREVIEW_UNAVAILABLE', message: error.message}); }
  const supported = preview?.schemaVersion === '0.1.0' && preview.mode === 'local-static' && Array.isArray(preview.routes) && Array.isArray(preview.assets);
  for (const message of validateFacts(facts, {projectRoot: root, ...(requirePreview && supported ? {previewConfig: preview} : {})})) issues.push({code: 'FACT_REFERENCE_INVALID', message});
  for (const asset of assets.filter(item => item.implementationMapping && (!changes.length || seen.has(item.implementationMapping)))) {
    try {
      const file = fileAt(root, asset.implementationMapping);
      if (!file) issues.push({code: 'SOURCE_MISSING', assetId: asset.id, path: asset.implementationMapping});
      else if (!asset.implementationSha256) issues.push({code: 'SOURCE_DIGEST_NOT_RECORDED', assetId: asset.id, path: asset.implementationMapping});
      else if (sha256(fs.readFileSync(file)) !== asset.implementationSha256) issues.push({code: 'SOURCE_STALE', assetId: asset.id, path: asset.implementationMapping});
    } catch (error) { issues.push({code: 'SOURCE_UNSAFE', assetId: asset.id, message: error.message}); }
  }
  for (const change of changes) {
    const file = fileAt(root, change.path), actual = file ? sha256(fs.readFileSync(file)) : null;
    if (actual !== change.sha256) issues.push({code: 'CHANGE_INPUT_STALE', path: change.path, expected: change.sha256, actual});
    const mappings = assets.filter(item => item.implementationMapping === change.path);
    if (change.sha256 !== null && !mappings.length) issues.push({code: 'SOURCE_NOT_REGISTERED', path: change.path});
    if (change.sha256 === null && mappings.length) issues.push({code: 'DELETED_SOURCE_STILL_REFERENCED', path: change.path});
  }
  if (requirePreview && !supported) issues.push({code: 'PREVIEW_NOT_CONNECTED', message: '当前可视页面交付需要工作台预览；保留原技术栈，先核实支持方式'});
  if (requirePreview && supported) for (const entry of [...preview.routes, ...preview.assets]) {
    try { if (!fileAt(root, entry.file)) issues.push({code: 'PREVIEW_SOURCE_MISSING', path: entry.file}); }
    catch (error) { issues.push({code: 'PREVIEW_SOURCE_UNSAFE', message: error.message}); }
  }
  return {schemaVersion: '1.0.0', project: root, state: issues.length ? 'sync-pending' : 'consistent', summary: issues.length ? '代码完成，Foundation同步待完成' : '源码字节、事实引用与所要求的预览映射一致', changes, issues, preview: {required: requirePreview, state: supported ? 'configured-not-browser-verified' : 'unavailable'}, semanticAcceptance: 'not-verified', mutationPerformed: false};
}

export function inspectProjectDelivery({installationRoot, project, changes, requirePreview = false} = {}) {
  const rules = readCurrentFoundationRules({installationRoot, project});
  // A renamed/deleted source can invalidate existing facts. This read-only
  // diagnostic must still expose that pending synchronization for an already
  // adopted, identity-checked project; it does not make the rules executable.
  if (!rules.projectRulesReady && !rules.adoption) return {state: 'not-ready', summary: '项目尚未就绪，不能宣称 Foundation 制作交付完成', nextStep: rules.nextStep, mutationPerformed: false};
  return {...inspectProjectDeliveryFiles({project, changes, requirePreview}), currentIdentityHash: rules.currentIdentityHash, ruleVersion: rules.ruleVersion};
}
