import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {realProject, resolveProjectFile} from './path-boundary.mjs';
import {validEventStatusIdentity} from './identity.mjs';
import {canonicalStringify} from './install-contract.mjs';
import {applyProjectMutationPlan} from './project-authority.mjs';
import {normalizeRelationHandlerPayload} from './project-mutation-handlers.mjs';

export const FACT_FILES = ['project', 'pages', 'relations', 'design-tokens', 'components', 'interactions', 'motions', 'changes', 'figma'];
export const now = () => new Date().toISOString();
export const stableId = (type, key) => `${type}_${crypto.createHash('sha256').update(`${type}:${key}`).digest('hex').slice(0, 12)}`;
export const emptyFact = (name) => ({schemaVersion: '0.1.0', items: [], kind: name});
export const foundationFiles = (project) => path.join(realProject(project), '.foundation');

export class RelationWriteError extends Error {
  constructor(code, message, cause = null, details = {}) {
    super(message, cause ? {cause} : undefined);
    this.name = 'RelationWriteError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function relationsVersion(document) {
  return crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16);
}

export function ensureSkeleton(project, {mutationPlan} = {}) {
  if (!mutationPlan) throw Object.assign(new Error('skeleton/facts create 必须提供 exact project mutation plan'), {code: 'HUMAN_AUTHORIZATION_REQUIRED'});
  if (realProject(project) !== mutationPlan.project || mutationPlan.operation !== 'foundation-skeleton-and-facts-create') throw Object.assign(new Error('skeleton mutation plan 目标或 handler 不匹配'), {code: 'PROJECT_HANDLER_BINDING_MISMATCH'});
  return applyProjectMutationPlan({plan: mutationPlan});
}

export function readFacts(project) {
  const root = foundationFiles(project);
  const output = {};
  for (const name of FACT_FILES) output[name] = JSON.parse(fs.readFileSync(path.join(root, 'facts', `${name}.json`), 'utf8'));
  const identity = path.join(root, 'identity', 'project.json');
  output.foundation = JSON.parse(fs.readFileSync(fs.existsSync(identity) ? identity : path.join(root, 'foundation.json'), 'utf8'));
  return output;
}

export function registerPageRelation(project, draft, {mutationPlan = null} = {}) {
  const root = realProject(project);
  const normalized = normalizeRelationHandlerPayload(draft, {generatedAt: mutationPlan?.handler?.payload?.generatedAt || new Date().toISOString()});
  if (!mutationPlan || mutationPlan.operation !== 'relation-facts-write' || mutationPlan.project !== root) throw Object.assign(new Error('关系写入必须提供 exact closed-handler project mutation plan'), {code: 'HUMAN_AUTHORIZATION_REQUIRED'});
  if (canonicalStringify(normalized) !== canonicalStringify(mutationPlan.handler?.payload)) throw Object.assign(new Error('关系 draft 与已授权 handler payload 不匹配'), {code: 'PROJECT_HANDLER_BINDING_MISMATCH'});
  return applyProjectMutationPlan({plan: mutationPlan});
}

function references(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function assetDocuments(facts) {
  return [['pages', facts.pages], ['components', facts.components], ['interactions', facts.interactions], ['motions', facts.motions]];
}

export function validateFacts(facts, {previewConfig, projectRoot} = {}) {
  const errors = [];
  for (const name of FACT_FILES) {
    const document = facts[name];
    if (!document || !document.schemaVersion || !Array.isArray(document.items)) {
      errors.push(`${name}.json 格式无效：需要 schemaVersion 和 items 数组`);
      continue;
    }
    const ids = new Set();
    for (const [index, item] of document.items.entries()) {
      for (const field of ['id', 'status', 'source', 'updatedAt', 'verificationStatus']) if (!item[field]) errors.push(`${name}.json.items[${index}].${field} 缺失`);
      if (item.id && ids.has(item.id)) errors.push(`${name}.json.items[${index}].id 重复：${item.id}`);
      if (item.id) ids.add(item.id);
    }
  }
  const pages = facts.pages?.items || [];
  const pageIds = new Set(pages.map((page) => page.id));
  const componentIds = new Set((facts.components?.items || []).map((component) => component.id));
  const assetIds = new Set(assetDocuments(facts).flatMap(([, document]) => document?.items || []).map((asset) => asset.id));
  const figmaIds = new Set((facts.figma?.items || []).map((mapping) => mapping.id));
  if (pages.length && pages.filter((page) => page.entry === true).length !== 1) errors.push('pages.json 存在页面时必须恰有一个 entry=true 的入口页');
  for (const [index, relation] of (facts.relations?.items || []).entries()) {
    if (!pageIds.has(relation.from)) errors.push(`relations.json.items[${index}].from 引用了不存在的页面：${relation.from}`);
    if (!pageIds.has(relation.to)) errors.push(`relations.json.items[${index}].to 引用了不存在的页面：${relation.to}`);
  }
  const components = facts.components?.items || [];
  const familyVariants = new Map();
  for (const component of components) {
    if (!component.family) continue;
    const variants = familyVariants.get(component.family) || new Set();
    for (const variant of component.variants || []) variants.add(variant);
    if (component.variant) variants.add(component.variant);
    familyVariants.set(component.family, variants);
  }
  const instances = new Map();
  for (const [componentIndex, component] of components.entries()) {
    if (!component.family || !familyVariants.has(component.family)) errors.push(`components.json.items[${componentIndex}].family 引用了不存在的组件家族：${component.family ?? '缺失'}`);
    for (const [usageIndex, usage] of (component.usageLocations || []).entries()) {
      if (!pageIds.has(usage.pageId)) errors.push(`components.json.items[${componentIndex}].usageLocations[${usageIndex}].pageId 引用了不存在的页面：${usage.pageId}`);
      if (usage.variant && !familyVariants.get(component.family)?.has(usage.variant)) errors.push(`components.json.items[${componentIndex}].usageLocations[${usageIndex}].variant 引用了不存在的变体：${usage.variant}`);
      if (component.id === 'component_event_status_badge' && !validEventStatusIdentity({pageId: usage.pageId, eventId: usage.eventId, status: usage.variant, instanceId: usage.instanceId})) errors.push(`components.json 资产 ${component.id} 字段 usageLocations[${usageIndex}].instanceId 与 EventStatus 页面/事件/状态身份规则不一致：${usage.instanceId}`);
      if (usage.instanceId && instances.has(usage.instanceId)) errors.push(`components.json 资产 ${component.id} 字段 usageLocations[${usageIndex}].instanceId 跨组件重复：${usage.instanceId}，已由 ${instances.get(usage.instanceId)} 登记`);
      if (usage.instanceId) instances.set(usage.instanceId, component.id);
    }
  }
  for (const [factName, document] of assetDocuments(facts)) {
    for (const [assetIndex, asset] of (document?.items || []).entries()) {
      if (asset.implementationMapping) {
        if (!projectRoot) errors.push(`${factName}.json 资产 ${asset.id} 字段 implementationMapping 无法校验：缺少项目根目录`);
        else {
          try { resolveProjectFile(projectRoot, asset.implementationMapping, `${factName}.json 资产 ${asset.id} 字段 implementationMapping`); }
          catch (error) { errors.push(error.message); }
        }
      }
      for (const field of ['dependencies', 'composes']) {
        for (const reference of references(asset[field])) if (!assetIds.has(reference)) errors.push(`${factName}.json 资产 ${asset.id} 字段 ${field} 引用了未登记资产：${reference}`);
      }
      for (const reference of references(asset.usedByComponents)) if (!componentIds.has(reference)) errors.push(`${factName}.json 资产 ${asset.id} 字段 usedByComponents 引用了未登记组件资产：${reference}`);
      if (asset.figmaMappingId && !figmaIds.has(asset.figmaMappingId)) errors.push(`${factName}.json 资产 ${asset.id} 字段 figmaMappingId 引用了不存在的 Figma 映射：${asset.figmaMappingId}`);
    }
  }
  for (const [index, mapping] of (facts.figma?.items || []).entries()) if (mapping.assetId && !assetIds.has(mapping.assetId)) errors.push(`figma.json 资产 ${mapping.id} 字段 assetId 引用了未登记资产：${mapping.assetId}`);
  for (const [index, change] of (facts.changes?.items || []).entries()) {
    for (const reference of references(change.affectedPages)) if (!pageIds.has(reference)) errors.push(`changes.json 资产 ${change.id} 字段 affectedPages 引用了不存在的页面资产：${reference}`);
    for (const reference of references(change.affectedAssets)) if (!assetIds.has(reference)) errors.push(`changes.json 资产 ${change.id} 字段 affectedAssets 引用了未登记资产：${reference}`);
  }
  if (previewConfig) {
    const routePaths = new Set(previewConfig.routes.map((entry) => entry.path));
    for (const [index, page] of pages.entries()) if (!routePaths.has(page.preview)) errors.push(`pages.json.items[${index}].preview 未在 preview.json.routes 声明：${page.preview ?? '缺失'}`);
  }
  return errors;
}
