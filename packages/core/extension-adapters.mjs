import fs from 'node:fs';
import path from 'node:path';
import {canonicalStringify, sha256} from './install-contract.mjs';
import {isWithin, realProject} from './path-boundary.mjs';
import {applyProjectMutationPlan, assertProjectMutationAuthority, createProjectMutationPlan} from './project-authority.mjs';

function safeProjectFile(project, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..') || relative.includes('\0')) throw new Error(`扩展文件路径非法：${relative}`);
  const target = path.resolve(project, relative);
  if (!isWithin(project, target)) throw new Error(`扩展文件越界：${relative}`);
  let parent = path.dirname(target);
  while (isWithin(project, parent) && parent !== project) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error(`扩展路径经过符号链接：${relative}`);
    parent = path.dirname(parent);
  }
  return target;
}

function extensionPlan(project, adapter, registry, installationRoot) {
  const root = realProject(project);
  assertProjectMutationAuthority(root, {installationRoot, capability: `extension-${adapter}-plan`});
  if (!registry || registry.schemaVersion !== '1.0.0' || !registry.item?.name || !Array.isArray(registry.item.files)) throw new Error('扩展 registry 元数据无效');
  const files = registry.item.files.map((file) => ({path: file.path, content: String(file.content), sha256: sha256(String(file.content))})).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) safeProjectFile(root, file.path);
  const seed = {schemaVersion: '1.0.0', adapter, project: root, installationRoot: path.resolve(installationRoot), source: registry.name, item: registry.item.name, version: registry.item.version || null, license: registry.item.license || null, ownership: 'project-owned', files};
  const planHash = sha256(canonicalStringify(seed));
  const handlerPayload = {...seed, planHash, appliedAt: new Date().toISOString()};
  const mutationPlan = createProjectMutationPlan({operation: `extension-${adapter}-apply`, project: root, installationRoot, handlerPayload, capabilityIds: [`adapter:${adapter}`]});
  return {...seed, planHash, mutationPlan};
}

function applyExtension(plan) {
  const {planHash, mutationPlan, ...seed} = plan;
  if (sha256(canonicalStringify(seed)) !== planHash) throw new Error('扩展 plan 已被改写');
  if (mutationPlan?.handler?.payload?.planHash !== planHash) throw new Error('扩展 mutation plan 未绑定 extension plan');
  return applyProjectMutationPlan({plan: mutationPlan});
}

function verifyExtension(plan) {
  const mismatches = plan.files.filter((file) => {
    const target = safeProjectFile(plan.project, file.path);
    return !fs.existsSync(target) || sha256(fs.readFileSync(target)) !== file.sha256;
  }).map((file) => file.path);
  return {ok: mismatches.length === 0, mismatches};
}

function createRemoveMutationPlan(plan) {
  const {planHash, mutationPlan: ignoredApplyPlan, ...seed} = plan;
  if (sha256(canonicalStringify(seed)) !== planHash) throw new Error('扩展 plan 已被改写');
  const handlerPayload = {...seed, planHash, appliedAt: new Date().toISOString()};
  return createProjectMutationPlan({operation: `extension-${plan.adapter}-remove-owned`, project: plan.project, installationRoot: plan.installationRoot, handlerPayload, preserves: ['modified-extension-files', 'project-source', '.foundation/facts'], capabilityIds: [`adapter:${plan.adapter}`]});
}

function removeExtension(plan, {mutationPlan} = {}) {
  if (mutationPlan?.handler?.payload?.planHash !== plan.planHash) throw new Error('扩展 remove mutation plan 未绑定 extension plan');
  return applyProjectMutationPlan({plan: mutationPlan});
}

export const SHADCN_ADAPTER = Object.freeze({
  name: 'shadcn',
  status: 'candidate-unverified',
  detect(project) {
    const root = realProject(project);
    const config = path.join(root, 'components.json');
    return {detected: fs.existsSync(config), config: fs.existsSync(config) ? config : null, globalCliRequired: false};
  },
  explain() { return '读取项目 components.json 和本地 registry 元数据；写入的组件源码归项目所有，Foundation 卸载不会删除。'; },
  plan({project, registry, installationRoot}) { return extensionPlan(project, 'shadcn', registry, installationRoot); },
  apply: applyExtension,
  verify: verifyExtension,
  planRemove: createRemoveMutationPlan,
  removeOwned: removeExtension,
});

export const ANT_ADAPTER = Object.freeze({
  name: 'ant',
  status: 'pending',
  detect(project) {
    const root = realProject(project);
    const file = path.join(root, 'package.json');
    const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const version = manifest.dependencies?.antd || manifest.devDependencies?.antd || null;
    return {detected: Boolean(version), version, globalCliRequired: false};
  },
  explain() { return '本轮只提供 Ant 检测与计划样例；不会全局安装 @ant-design/cli，也不会批量修改组件。'; },
  plan({project, installationRoot}) { const root = realProject(project); assertProjectMutationAuthority(root, {installationRoot, capability: 'extension-ant-plan'}); return {schemaVersion: '1.0.0', adapter: 'ant', project: root, installationRoot: path.resolve(installationRoot), status: 'pending', actions: ['detect', 'explain', 'plan'], ownership: 'project-owned'}; },
  apply() { return {ok: false, status: 'pending', reason: 'ANT_IMPLEMENTATION_OUTSIDE_024_BASE'}; },
  verify() { return {ok: false, status: 'pending'}; },
  planRemove() { return {ok: false, status: 'pending'}; },
  removeOwned() { return {ok: false, status: 'pending'}; },
});
