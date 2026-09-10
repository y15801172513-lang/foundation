import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DEMO = path.join(ROOT, 'examples/button-two-page');
export const EVENTS = path.join(ROOT, 'examples/foundation-events');
const TMP = path.join(ROOT, '.tmp');
const PRODUCT_FIXTURE_ROOT = process.env.FOUNDATION_TEST_PRODUCT_ROOT
  ? path.resolve(process.env.FOUNDATION_TEST_PRODUCT_ROOT)
  : null;

function requireProductFixtureRoot() {
  if (!PRODUCT_FIXTURE_ROOT || !path.isAbsolute(PRODUCT_FIXTURE_ROOT)) throw new Error('项目权限测试必须通过 FOUNDATION_TEST_PRODUCT_ROOT 指向嵌套 Foundation source 的真实同级 product 根');
  if (!fs.existsSync(PRODUCT_FIXTURE_ROOT)) fs.mkdirSync(PRODUCT_FIXTURE_ROOT, {recursive: true});
  if (fs.lstatSync(PRODUCT_FIXTURE_ROOT).isSymbolicLink() || fs.realpathSync(PRODUCT_FIXTURE_ROOT) !== PRODUCT_FIXTURE_ROOT) throw new Error(`项目测试根必须是无符号链接的真实目录：${PRODUCT_FIXTURE_ROOT}`);
  return PRODUCT_FIXTURE_ROOT;
}

export function makeTempDirectory(prefix) {
  fs.mkdirSync(TMP, {recursive: true});
  return fs.mkdtempSync(path.join(TMP, prefix));
}

export function makeScopedTempDirectory(scope, prefix) {
  if (!scope || path.isAbsolute(scope)) throw new Error(`临时目录 scope 必须是 .tmp 内相对路径：${scope}`);
  const directory = path.resolve(TMP, scope);
  const relative = path.relative(TMP, directory);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`拒绝在 .tmp 外创建临时目录：${directory}`);
  fs.mkdirSync(directory, {recursive: true});
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`拒绝在符号链接目录内创建临时文件：${directory}`);
  return fs.mkdtempSync(path.join(directory, prefix));
}

export function projectFixturePath(temporaryRoot, ...segments) {
  const productRoot = requireProductFixtureRoot();
  const scope = path.basename(path.resolve(temporaryRoot));
  const target = path.resolve(productRoot, scope, ...segments);
  const relative = path.relative(productRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`项目 fixture 逃出 product 根：${target}`);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  return target;
}

export function copyProjectFixture(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(candidate) {
      return !path.relative(source, candidate).split(path.sep).some((segment) => ['.git', '.tmp', 'node_modules'].includes(segment));
    },
  });
}

export function removeTempDirectory(directory) {
  const resolved = path.resolve(directory);
  const relative = path.relative(TMP, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`拒绝清理 .tmp 外路径：${resolved}`);
  if (!fs.existsSync(resolved)) return;
  if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error(`拒绝清理符号链接目录：${resolved}`);
  fs.rmSync(resolved, {recursive: true, force: true});
  if (PRODUCT_FIXTURE_ROOT) {
    const productScope = path.join(requireProductFixtureRoot(), path.basename(resolved));
    if (fs.existsSync(productScope)) fs.rmSync(productScope, {recursive: true, force: true});
  }
}

export function copyDemo(prefix = 'prompt010-demo-') {
  const destination = makeTempDirectory(prefix);
  fs.cpSync(DEMO, destination, {recursive: true});
  return destination;
}

export function snapshotFacts(project = DEMO) {
  const facts = path.join(project, '.foundation', 'facts');
  return Object.fromEntries(fs.readdirSync(facts).sort().map((name) => [name, fs.readFileSync(path.join(facts, name), 'utf8')]));
}
