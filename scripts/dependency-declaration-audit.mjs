import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', '.foundation', '.tmp', 'node_modules', 'dist', 'coverage']);
const buildOnlyPackages = new Set(['vite', '@vitejs/plugin-react', 'tailwindcss', '@tailwindcss/vite']);

function walk(directory, accept) {
  const files = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, accept));
    else if (entry.isFile() && accept(absolute)) files.push(absolute);
  }
  return files;
}

function packageName(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

function directImports(source) {
  const result = new Set();
  const expression = /(?:from\s*|import\s*\(|import\s*)['"]([^'".][^'"]*)['"]|require\(\s*['"]([^'".][^'"]*)['"]\s*\)/gu;
  for (const match of source.matchAll(expression)) {
    const specifier = match[1] || match[2];
    if (specifier && !specifier.startsWith('node:')) result.add(packageName(specifier));
  }
  return [...result].sort();
}

function ownerFor(file, packageRoots) {
  return packageRoots.filter((root) => file === root || file.startsWith(`${root}${path.sep}`)).sort((left, right) => right.length - left.length)[0];
}

export function auditDependencyDeclarations(root = repositoryRoot) {
  const manifestFiles = walk(root, (file) => path.basename(file) === 'package.json');
  const packageRoots = manifestFiles.map(path.dirname);
  const manifests = new Map(manifestFiles.map((file) => [path.dirname(file), JSON.parse(fs.readFileSync(file, 'utf8'))]));
  const entryFiles = walk(root, (file) => path.basename(file) === 'build.mjs' || /\.config\.(?:js|jsx|mjs|cjs|ts|tsx)$/u.test(path.basename(file)));
  const findings = [];
  for (const file of entryFiles) {
    const owner = ownerFor(file, packageRoots);
    if (!owner) continue;
    const manifest = manifests.get(owner);
    const groups = {dependencies: manifest.dependencies || {}, devDependencies: manifest.devDependencies || {}, optionalDependencies: manifest.optionalDependencies || {}, peerDependencies: manifest.peerDependencies || {}};
    for (const name of directImports(fs.readFileSync(file, 'utf8'))) {
      const declaredIn = Object.entries(groups).find(([, dependencies]) => Object.hasOwn(dependencies, name))?.[0] || null;
      if (!declaredIn) findings.push({rule: 'undeclared-direct-import', package: manifest.name, file: path.relative(root, file).replaceAll('\\', '/'), dependency: name});
      else if (buildOnlyPackages.has(name) && declaredIn !== 'devDependencies') findings.push({rule: 'build-tool-not-dev-dependency', package: manifest.name, file: path.relative(root, file).replaceAll('\\', '/'), dependency: name, declaredIn});
    }
  }
  return {ok: findings.length === 0, scannedEntries: entryFiles.map((file) => path.relative(root, file).replaceAll('\\', '/')), findings};
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const report = auditDependencyDeclarations();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
