import {SCENE_RUNTIME_IMPORTS,SCENE_RUNTIME_TYPES} from '../packages/core/scene-runtime-contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildCandidate, createFoundationRuntimeDescriptor, productVersion, readRepositoryGitCommit} from '@foundation/core';
import {thirdPartyNotices,productionDependencyClosure} from './third-party-notices.mjs';
import {auditCapabilityArtifact} from '../packages/core/capability-authority.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? path.resolve(process.argv[index + 1]) : fallback;
};
const TMP = option('--work-root', path.join(ROOT, '.tmp', 'candidate-build'));
const SOURCE = path.join(TMP, 'source');
const VERSION = productVersion(ROOT);
const OUTPUT = option('--output', path.join(ROOT, '.tmp', 'candidates', `foundation-${VERSION}-${process.platform}-${process.arch}`));
const MANAGEMENT_DIST = option('--management-dist', path.join(ROOT,'apps/management-center/dist'));
const RUNTIME_ARCHIVE = option('--runtime-archive', null);
const COMMIT = readRepositoryGitCommit(ROOT) || 'uncommitted-local';
const DIRTY = spawnSync('git', ['status', '--short'], {cwd: ROOT, encoding: 'utf8'}).stdout.trim().length > 0;
const ESBUILD = path.join(ROOT, 'examples', 'foundation-events', 'node_modules', '.bin', 'esbuild');
const bundledInputs = new Set();
// Validate the exact bundled Skill before creating any candidate output.
const capability = auditCapabilityArtifact(path.join(ROOT, 'skills', 'ai-product-foundation-kit', 'capability.json')).manifest;

function copyTree(source, destination, accept = () => true) {
  fs.mkdirSync(destination, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (!accept(from, entry)) continue;
    if (entry.isDirectory()) copyTree(from, to, accept);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`候选源拒绝非普通文件：${from}`);
  }
}

function copy(relative, destination = relative, accept) {
  const source = path.join(ROOT, relative);
  const target = path.join(SOURCE, 'app', destination);
  if (fs.statSync(source).isDirectory()) copyTree(source, target, accept);
  else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(source, target); }
}

function bundle(entry, destination, external = [], browser = false) {
  if (!fs.existsSync(ESBUILD)) throw new Error('候选构建缺少仓库内已声明 Vite 工具链的 esbuild；禁止回退到网络安装');
  const target = path.join(SOURCE, 'app', destination);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const metafile = path.join(TMP, `bundle-${bundledInputs.size}-${path.basename(destination)}.json`);
  const run = spawnSync(ESBUILD, [
    path.join(ROOT, entry),
    '--bundle',
    browser?'--platform=browser':'--platform=node',
    ...(browser?['--define:process.env.NODE_ENV="production"']:[]),
    '--format=esm',
    '--target=node20',
    '--log-level=warning',
    `--metafile=${metafile}`,
    ...['ts-morph',...external].map((specifier) => `--external:${specifier}`),
    `--outfile=${target}`,
  ], {cwd: ROOT, encoding: 'utf8'});
  if (run.status !== 0) throw new Error(`候选模块闭包构建失败：${entry}\n${run.stderr || run.stdout}`);
  for (const input of Object.keys(JSON.parse(fs.readFileSync(metafile, 'utf8')).inputs)) bundledInputs.add(input);
}

const boundary = fs.realpathSync(path.join(ROOT, '.tmp'));
for (const target of [TMP, OUTPUT]) {
  const relative = path.relative(boundary, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('候选构建目录必须位于本仓库真实 .tmp 子目录');
  let cursor = boundary;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) {
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('候选构建拒绝悬空符号链接'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    if (fs.lstatSync(cursor).isSymbolicLink() || fs.realpathSync(cursor) !== cursor) throw new Error('候选构建拒绝符号链接路径');
  }
  if (fs.existsSync(target)) throw new Error('候选构建目录已存在；请选择新的 --work-root 和 --output，保留旧产物与失败证据');
}
if (TMP === OUTPUT || TMP.startsWith(`${OUTPUT}${path.sep}`) || OUTPUT.startsWith(`${TMP}${path.sep}`)) throw new Error('候选工作目录与输出目录不得重叠');
fs.mkdirSync(path.join(SOURCE, 'app'), {recursive: true});

copy('foundation-kit.json');
copy('package.json');
// The approved project MIT notice must accompany the executable copy too.
// The same owned-code text is maintained in the standalone launcher source.
copy('distribution/summon-foundation/LICENSE', 'LICENSE');
copy('packages/core/package.json');
copy('packages/cli/package.json');
copy('apps/management-center/package.json');
copy('apps/management-center/package.json', 'node_modules/@foundation/management-center/package.json');
if(fs.realpathSync(MANAGEMENT_DIST)!==MANAGEMENT_DIST || !MANAGEMENT_DIST.startsWith(ROOT+path.sep))throw new Error('工作台构建输入必须是本项目真实目录');
copyTree(MANAGEMENT_DIST,path.join(SOURCE,'app/node_modules/@foundation/management-center/dist'));
const analysisDependencies=productionDependencyClosure(ROOT,['ts-morph']);
for(const dependency of analysisDependencies) {
  copy(dependency.relative,dependency.relative,(_file,entry)=>entry.name!=='node_modules');
  bundledInputs.add(`${dependency.relative}/package.json`);
}
fs.writeFileSync(path.join(SOURCE,'app','analysis-dependencies.json'),JSON.stringify(analysisDependencies.map(({directory,...record})=>record),null,2)+'\n');
copy('packages/core/schemas','artifacts/schemas');
copy('packages/core/notices','artifacts/notices');
for(const directory of ['packages/cli','node_modules/@foundation/management-center/src/server']) {
  copy('packages/core/source-analysis.mjs',`${directory}/source-analysis.mjs`);
  copy('packages/core/source-analysis-worker.mjs',`${directory}/source-analysis-worker.mjs`);
}
bundle('packages/cli/index.mjs', 'packages/cli/index.mjs', ['@foundation/management-center', './runtime-surface.mjs', './browser-launch.mjs', './platform-account.mjs']);
bundle('packages/core/uninstall-finalizer.mjs', 'packages/cli/uninstall-finalizer.mjs', ['./runtime-surface.mjs']);
copy('packages/core/runtime-surface.mjs', 'packages/cli/runtime-surface.mjs');
copy('packages/core/browser-launch.mjs', 'packages/cli/browser-launch.mjs');
copy('packages/core/platform-account.mjs', 'packages/cli/platform-account.mjs');
bundle('apps/management-center/src/server/index.mjs', 'node_modules/@foundation/management-center/src/server/index.mjs', ['./runtime-surface.mjs']);
copy('packages/core/runtime-surface.mjs', 'node_modules/@foundation/management-center/src/server/runtime-surface.mjs');
bundle('apps/management-center/src/server/workbench-validation-worker.mjs','node_modules/@foundation/management-center/src/server/workbench-validation-worker.mjs',['./runtime-surface.mjs']);
bundle('apps/management-center/src/scene-react-runtime.mjs','artifacts/preview/react-runtime.mjs',[],true);
const sceneRuntime=await import(new URL('file://'+path.join(SOURCE,'app/artifacts/preview/react-runtime.mjs')));
for(const contract of Object.values(SCENE_RUNTIME_IMPORTS)){
  for(const name of [...contract.named,...(contract.default?['default']:[])])if(!(name in sceneRuntime)||typeof sceneRuntime[name]!==SCENE_RUNTIME_TYPES[name])throw new Error('候选场景运行库缺少合同导出：'+name);
  fs.writeFileSync(path.join(SOURCE,'app/artifacts/preview',contract.file),'export {'+[...contract.named,...(contract.default?['default']:[])].join(',')+"} from './react-runtime.mjs';\n");
}

copy('packages/core/preview-bridge.mjs','artifacts/preview/preview-bridge.mjs');
copy('packages/core/asset-preview-bridge.mjs','artifacts/preview/asset-preview-bridge.mjs');
copy('packages/core/object-identity.mjs','artifacts/preview/object-identity.mjs');
copy('templates');
copy('skills', 'artifacts/skills');
copy('rules', 'artifacts/rules');
copy('migrations');
const uiNotices = path.join(SOURCE, 'app', 'node_modules', '@foundation', 'management-center', 'dist', 'THIRD_PARTY_NOTICES.txt');
if (!fs.existsSync(uiNotices)) throw new Error('发行缺少管理工作台第三方许可；请先重新构建');
fs.writeFileSync(path.join(SOURCE, 'app', 'THIRD_PARTY_NOTICES.txt'), `${thirdPartyNotices([...bundledInputs], ROOT)}\n${fs.readFileSync(uiNotices, 'utf8')}`);

const runtimeDescriptor = createFoundationRuntimeDescriptor({
  productVersion: VERSION,
  platform: process.platform,
  arch: process.arch,
  buildIdentity: `${COMMIT}${DIRTY ? '+worktree' : ''}`,
  supportedProjectDataFormats: ['0.1.0', '0.1.1'],
  factCapabilities:['component-delivery/1','semantic-review/1','automatic-project-context/1','project-round/1','deletion-review/1'],
  ruleCapabilityEndpoint: 'artifacts',
  ruleCapabilityEndpointRoot: path.join(SOURCE, 'app', 'artifacts'),
  capabilityFacts: {
    bundled: [{capabilityId: capability.capabilityId, type: capability.type, version: capability.version, manifestPath: `skills/${capability.capabilityId}/capability.json`, installed: true, active: false, projectScoped: capability.projectScoped}],
    installedStateSource: 'state/capabilities.json',
    activeStateSource: 'state/capabilities.json',
    registrationStateSource: 'state/capability-host-registrations.json',
  },
});
fs.writeFileSync(path.join(SOURCE, 'app', 'foundation-runtime-descriptor.json'), `${JSON.stringify(runtimeDescriptor, null, 2)}\n`, {mode: 0o600});

const built = buildCandidate({sourceRoot: SOURCE, outputRoot: OUTPUT, productVersion: VERSION, platform: process.platform, arch: process.arch, runtimeSource: RUNTIME_ARCHIVE ? null : process.execPath, runtimeArchive: RUNTIME_ARCHIVE, entrypoint: 'app/packages/cli/index.mjs', sourceKind: 'repository-local-build', buildIdentity: `${COMMIT}${DIRTY ? '+worktree' : ''}`});
process.stdout.write(`${JSON.stringify({candidate: built.root, productVersion: VERSION, platform: process.platform, arch: process.arch, candidateHash: built.manifest.candidateHash, totalBytes: built.manifest.totalBytes, signature: built.manifest.signature, productionDistribution: 'pending'}, null, 2)}\n`);
