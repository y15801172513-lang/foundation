import fs from 'node:fs';
import path from 'node:path';
import {foundationFiles, readFacts} from './facts.mjs';
import {normalizePublicPath, resolveProjectFile} from './path-boundary.mjs';

export const PREVIEW_SCHEMA_VERSION = '0.1.0';
export const PREVIEW_MODES = ['local-static'];
export const EMPTY_PREVIEW_CONFIG = {schemaVersion: PREVIEW_SCHEMA_VERSION, mode: 'local-static', routes: [], assets: []};

function validateEntries(project, entries, kind, errors) {
  if (!Array.isArray(entries)) {
    errors.push(`preview.json.${kind} 必须是数组`);
    return [];
  }
  const seen = new Set();
  return entries.flatMap((entry, index) => {
    const prefix = `preview.json.${kind}[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix} 必须是对象`);
      return [];
    }
    let publicPath;
    let absoluteFile;
    try { publicPath = normalizePublicPath(entry.path, `${prefix}.path`); } catch (error) { errors.push(error.message); }
    try { absoluteFile = resolveProjectFile(project, entry.file, `${prefix}.file`); } catch (error) { errors.push(error.message); }
    if (publicPath && seen.has(publicPath)) errors.push(`${prefix}.path 重复声明：${publicPath}`);
    if (publicPath) seen.add(publicPath);
    return publicPath && absoluteFile ? [{path: publicPath, file: entry.file, absoluteFile}] : [];
  });
}

export function inspectPreviewConfig(project, {facts} = {}) {
  const file = path.join(foundationFiles(project), 'preview.json');
  const errors = [];
  let raw;
  if (!fs.existsSync(file)) return {ok: false, errors: ['缺少 .foundation/preview.json'], config: null};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {ok: false, errors: ['preview.json 不是有效 JSON'], config: null}; }
  if (raw.schemaVersion !== PREVIEW_SCHEMA_VERSION) errors.push(`preview.json.schemaVersion 必须是 ${PREVIEW_SCHEMA_VERSION}`);
  if (!PREVIEW_MODES.includes(raw.mode)) errors.push(`preview.json.mode 不支持：${raw.mode ?? '缺失'}`);
  const routes = validateEntries(project, raw.routes, 'routes', errors);
  const assets = validateEntries(project, raw.assets, 'assets', errors);
  const allPaths = new Set();
  for (const entry of [...routes, ...assets]) {
    if (allPaths.has(entry.path)) errors.push(`preview.json 路径在 route/asset 间重复：${entry.path}`);
    allPaths.add(entry.path);
  }
  let currentFacts = facts;
  if (!currentFacts) {
    try { currentFacts = readFacts(project); } catch { currentFacts = null; }
  }
  if (currentFacts) {
    const routePaths = new Set(routes.map((entry) => entry.path));
    for (const page of currentFacts.pages?.items || []) if (!routePaths.has(page.preview)) errors.push(`pages.json 页面 ${page.id} 的 preview ${page.preview ?? '缺失'} 未在 preview.json.routes 声明`);
  }
  return {ok: errors.length === 0, errors, config: {schemaVersion: raw.schemaVersion, mode: raw.mode, routes, assets}};
}

export function readPreviewConfig(project, options) {
  const result = inspectPreviewConfig(project, options);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.config;
}

export function previewPublicConfig(config) {
  return {schemaVersion: config.schemaVersion, mode: config.mode, allowedOrigins: ['self']};
}
