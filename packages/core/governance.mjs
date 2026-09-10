import fs from 'node:fs';
import path from 'node:path';
import {realProject} from './path-boundary.mjs';
import {foundationUiPolicyRecord} from './ui-policy.mjs';

export {FOUNDATION_UI_POLICY, foundationUiPolicyRecord} from './ui-policy.mjs';

const IGNORED_DIRECTORIES = new Set(['.git', '.foundation', '.tmp', 'node_modules', 'dist', 'build', 'coverage']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.html', '.vue', '.svelte']);

function walkProject(root) {
  const files = [];
  const skippedSymlinks = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) { skippedSymlinks.push(relative); continue; }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  };
  visit(root);
  return {files, skippedSymlinks};
}

function duplicateCandidates(files) {
  const byName = new Map();
  for (const file of files) {
    const key = path.basename(file, path.extname(file)).replace(/(?:\.test|\.spec)$/i, '').toLowerCase();
    if (!key) continue;
    const matches = byName.get(key) || [];
    matches.push(file);
    byName.set(key, matches);
  }
  return [...byName.entries()].filter(([, paths]) => paths.length > 1).map(([name, paths]) => ({name, paths})).sort((left, right) => left.name.localeCompare(right.name));
}

function packageManifest(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function classifyUiSystem(root, files, contents) {
  const manifest = packageManifest(root);
  const dependencies = {...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies};
  const combined = [...contents.values()].join('\n');
  const hasShadcn = files.includes('components.json') || files.some((file) => /(^|\/)components\/ui\//.test(file)) || Boolean(dependencies.shadcn) || /data-slot=|@\/components\/ui\//.test(combined);
  const specialistPackages = ['@xyflow/react', 'reactflow', 'monaco-editor', 'codemirror', 'three', 'pixi.js'].filter((name) => dependencies[name]);
  if (hasShadcn) return {classification: 'existing-shadcn', specialistEngines: specialistPackages};
  if (specialistPackages.length) return {classification: 'specialist-engine', specialistEngines: specialistPackages};
  if (files.includes('package.json') && contents.size >= 8) return {classification: 'mature-non-shadcn', specialistEngines: []};
  return {classification: 'unstable-ui', specialistEngines: []};
}

export function inventoryExistingProject(project) {
  const root = realProject(project);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('已有项目盘点目标必须是存在的目录');
  const {files, skippedSymlinks} = walkProject(root);
  const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const contents = new Map(sourceFiles.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const pages = sourceFiles.filter((file) => /(^|\/)(pages?|routes?|app)(\/|\.|$)|(^|\/)index\.(?:jsx?|tsx?|html)$/i.test(file));
  const components = sourceFiles.filter((file) => /(^|\/)components?\//i.test(file) || /^[A-Z]/.test(path.basename(file)));
  const interactions = sourceFiles.filter((file) => /(?:onClick|onChange|onSubmit|addEventListener|pointer|keydown|keyup)/.test(contents.get(file)));
  const motions = sourceFiles.filter((file) => /(?:@keyframes|animation\s*:|transition\s*:|view-transition|\bmotion\b)/.test(contents.get(file)));
  const uiSystem = classifyUiSystem(root, files, contents);
  return {
    governanceMode: 'preserve-and-inventory',
    uiPolicy: foundationUiPolicyRecord('existing', uiSystem.classification),
    uiSystem,
    projectRoot: root,
    scannedFiles: files,
    pages,
    components,
    interactions,
    motions,
    duplicateCandidates: duplicateCandidates(sourceFiles),
    skippedSymlinks,
    migration: {authorized: false, performed: false},
  };
}
