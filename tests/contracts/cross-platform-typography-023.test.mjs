import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

import {FOUNDATION_UI_POLICY} from '../../packages/core/ui-policy.mjs';
import {auditUiGovernance} from '../../scripts/ui-governance-audit.mjs';
import {applyFoundationFontPlatform, foundationFontPlatform} from '../../apps/management-center/src/foundation-font-platform.mjs';
import {browserLaunchContract} from '../helpers/browser-launch-contract.mjs';
import {evaluateWindowsFontEvidence} from '../helpers/platform-font-evidence.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (file) => readFile(resolve(root, file), 'utf8');
const baseFontStack = '"Geist Variable", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
const windowsFontStack = '"Geist Variable", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
const macOSFontStack = '"Geist Variable", "PingFang SC", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';

test('023 both documents consume one repository-owned Geist source through local Tailwind themes', async () => {
  const management = await read('apps/management-center/src/styles.css');
  const example = await read('examples/foundation-events/src/styles.css');
  const fontSource = await read('apps/management-center/src/foundation-geist.css');

  assert.equal((fontSource.match(/@import\s+["']@fontsource-variable\/geist["']/gu) || []).length, 1);
  assert.match(management, /@import\s+["']\.\/foundation-geist\.css["']/u);
  assert.match(example, /@import\s+["']\.\.\/\.\.\/\.\.\/apps\/management-center\/src\/foundation-geist\.css["']/u);
  assert.doesNotMatch(management, /@import\s+["']@fontsource-variable\/geist["']/u);
  assert.doesNotMatch(example, /@import\s+["']@fontsource-variable\/geist["']/u);
  for (const source of [management, example]) {
    assert.match(source, /--font-sans:\s*var\(--foundation-font-sans\)/u);
    for (const stack of [baseFontStack, windowsFontStack, macOSFontStack]) assert.match(source, new RegExp(stack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(source, /https?:\/\/[^;)"']+\.(?:woff2?|ttf|otf)/iu);
  }

  const managementMain = await read('apps/management-center/src/main.jsx');
  const exampleMain = await read('examples/foundation-events/src/main.jsx');
  assert.match(managementMain, /applyFoundationFontPlatform\(\)/u);
  assert.match(exampleMain, /applyFoundationFontPlatform\(\)/u);
});

test('023 font-sans is the sole normal UI family authority and both documents declare zh-CN', async () => {
  const management = await read('apps/management-center/src/styles.css');
  const example = await read('examples/foundation-events/src/styles.css');
  const managementBody = management.match(/body\s*\{[^}]*\}/u)?.[0] || '';
  const exampleBody = example.match(/body\s*\{[^}]*\}/u)?.[0] || '';
  assert.doesNotMatch(managementBody, /font-family/u);
  assert.doesNotMatch(exampleBody, /font-family/u);
  assert.match(management, /html\s*\{[^}]*@apply\s+font-sans/u);
  assert.match(exampleBody, /\bfont-sans\b/u);
  assert.match(await read('apps/management-center/index.html'), /<html\s+lang="zh-CN">/u);
  assert.match(await read('examples/foundation-events/index.html'), /<html\s+lang="zh-CN">/u);
});

test('023 platform selection is deterministic and only writes the document typography marker', () => {
  assert.equal(foundationFontPlatform({userAgentData: {platform: 'Windows'}}), 'windows');
  assert.equal(foundationFontPlatform({platform: 'MacIntel'}), 'macos');
  assert.equal(foundationFontPlatform({platform: 'Linux x86_64'}), 'other');
  const documentLike = {documentElement: {dataset: {theme: 'dark'}}};
  assert.equal(applyFoundationFontPlatform(documentLike, {platform: 'Win32'}), 'windows');
  assert.deepEqual(documentLike.documentElement.dataset, {theme: 'dark', fontPlatform: 'windows'});
});

test('023 shared content roles use script-safe size, weight, leading, and tracking semantics', async () => {
  const roles = await read('apps/management-center/src/components/foundation/content-roles.jsx');
  const expected = [
    ['PageTitle', 'text-2xl font-semibold leading-snug'],
    ['PanelTitle', 'font-heading text-xl font-medium leading-snug'],
    ['SectionTitle', 'text-lg font-medium leading-snug'],
    ['ImportantText', 'text-base leading-relaxed'],
    ['ContentDescription', 'text-xs leading-relaxed text-muted-foreground'],
    ['MetadataText', 'text-xs leading-normal text-muted-foreground'],
    ['CodeText', 'font-mono text-xs leading-normal'],
  ];
  for (const [role, classes] of expected) assert.match(roles, new RegExp(`function ${role}\\([\\s\\S]*?'${classes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.doesNotMatch(roles, /tracking-tight/u);

  const example = await read('examples/foundation-events/src/styles.css');
  assert.doesNotMatch(example, /events-header h1[^}]*tracking-tight/u);
});

test('023 local shadcn titles allow Chinese wrapping without negative tracking or leading-none', async () => {
  for (const file of ['apps/management-center/src/components/ui/dialog.jsx', 'examples/foundation-events/src/components/ui/dialog.tsx']) {
    const source = await read(file);
    const title = source.match(/data-slot="dialog-title"[\s\S]*?(?:\/>|\}\s*\))/u)?.[0] || source;
    assert.match(title, /text-xl/u);
    assert.match(title, /font-medium/u);
    assert.match(title, /leading-snug/u);
    assert.doesNotMatch(title, /leading-none|tracking-tight/u);
  }
  const empty = await read('apps/management-center/src/components/ui/empty.jsx');
  assert.doesNotMatch(empty, /data-slot="empty-title"[\s\S]{0,220}tracking-tight/u);
});

test('023 governance policy, product profile, docs, and audit expose the cross-platform typography contract', async () => {
  assert.equal(FOUNDATION_UI_POLICY.typography?.version, '023');
  assert.equal(FOUNDATION_UI_POLICY.typography?.newProjects, 'cross-platform-font-sans');
  assert.equal(FOUNDATION_UI_POLICY.typography?.existingProjects, 'preserve-and-inventory');

  const profile = await read('apps/management-center/src/foundation-ui-profile.mjs');
  assert.match(profile, /crossPlatformTypography/u);
  assert.match(profile, /Geist Variable/u);
  assert.match(profile, /windows:\s*\['PingFang SC',\s*'Microsoft YaHei UI',\s*'Microsoft YaHei'\]/u);

  const contract = await read('docs/FOUNDATION_SHADCN_TYPE_SPACING_GOVERNANCE_V01.md');
  for (const term of ['Geist Variable', 'Microsoft YaHei UI', 'PingFang SC', 'preserve-and-inventory', 'leading-snug', 'tabular-nums']) assert.match(contract, new RegExp(term));

  const report = await auditUiGovernance();
  assert.deepEqual(report.blockingFindings, []);
  for (const rule of ['rawFontFamily', 'rawFontWeight', 'rawLineHeight', 'rawLetterSpacing', 'globalTabularNumbers']) assert.ok(Object.hasOwn(report.counts, rule), `audit must execute ${rule}`);
});

test('023R1 Windows CJK evidence selects PingFang only after the isolated glyph probe proves it usable', () => {
  const result = evaluateWindowsFontEvidence({
    probeFonts: [{familyName: 'PingFang SC', postScriptName: 'PingFangSC-Regular', glyphCount: 8, isCustomFont: false}],
    latinFonts: [{familyName: 'Geist', postScriptName: 'Geist-Medium', glyphCount: 12, isCustomFont: true}],
    cjkTargets: [
      {target: 'outerChinese', fonts: [{familyName: 'PingFang SC', postScriptName: 'PingFangSC-Medium', glyphCount: 4, isCustomFont: false}]},
      {target: 'innerChinese', fonts: [{familyName: 'PingFang SC', postScriptName: 'PingFangSC-Semibold', glyphCount: 4, isCustomFont: false}]},
    ],
    mixedTargets: [{target: 'outerMixed', fonts: [
      {familyName: 'Geist', postScriptName: 'Geist-Regular', glyphCount: 10, isCustomFont: true},
      {familyName: 'PingFang SC', postScriptName: 'PingFangSC-Regular', glyphCount: 4, isCustomFont: false},
    ]}],
  });

  assert.equal(result.selectedBranch, 'pingfang');
  assert.equal(result.probe.usablePingFang, true);
  assert.deepEqual(result.cjkFamilies, ['PingFang SC']);
  assert.equal(result.packagedLatin, true);
});

test('023R1 Windows CJK evidence selects YaHei only after the isolated glyph probe proves PingFang unavailable', () => {
  const result = evaluateWindowsFontEvidence({
    probeFonts: [{familyName: 'Microsoft YaHei UI', postScriptName: 'MicrosoftYaHeiUI', glyphCount: 8, isCustomFont: false}],
    latinFonts: [{familyName: 'Geist', postScriptName: 'Geist-Medium', glyphCount: 12, isCustomFont: true}],
    cjkTargets: [
      {target: 'outerChinese', fonts: [{familyName: 'Microsoft YaHei UI', postScriptName: 'MicrosoftYaHeiUI', glyphCount: 4, isCustomFont: false}]},
      {target: 'innerChinese', fonts: [{familyName: 'Microsoft YaHei', postScriptName: 'MicrosoftYaHei', glyphCount: 4, isCustomFont: false}]},
    ],
    mixedTargets: [{target: 'innerMixed', fonts: [
      {familyName: 'Geist', postScriptName: 'Geist-Regular', glyphCount: 10, isCustomFont: true},
      {familyName: 'Microsoft YaHei UI', postScriptName: 'MicrosoftYaHeiUI', glyphCount: 4, isCustomFont: false},
    ]}],
  });

  assert.equal(result.selectedBranch, 'yahei');
  assert.equal(result.probe.usablePingFang, false);
  assert.deepEqual(result.cjkFamilies, ['Microsoft YaHei UI', 'Microsoft YaHei']);
  assert.equal(result.packagedLatin, true);
});

test('023R1 browser launch defaults to the sandbox and permits only the explicit no-sandbox value 1', async () => {
  const safeDefault = browserLaunchContract({});
  assert.equal(safeDefault.sandboxMode, 'default');
  assert.equal(safeDefault.optInSource, null);
  assert.equal(safeDefault.args.includes('--no-sandbox'), false);

  const explicitException = browserLaunchContract({FOUNDATION_BROWSER_NO_SANDBOX: '1'});
  assert.equal(explicitException.sandboxMode, 'explicit-no-sandbox');
  assert.equal(explicitException.optInSource, 'FOUNDATION_BROWSER_NO_SANDBOX=1');
  assert.equal(explicitException.args.includes('--no-sandbox'), true);

  for (const value of ['true', 'yes', 'on', '0', ' 1 ']) {
    assert.throws(() => browserLaunchContract({FOUNDATION_BROWSER_NO_SANDBOX: value}), /FOUNDATION_BROWSER_NO_SANDBOX.*只能精确设置为 1/u);
  }

  for (const fixture of [
    'tests/browser/cross-platform-typography-023.test.mjs',
    'tests/browser/foundation-ui-matrix-021.test.mjs',
    'tests/browser/asset-preview-isolation-021.test.mjs',
  ]) {
    const source = await read(fixture);
    assert.doesNotMatch(source, /['"]--no-sandbox['"]/u, `${fixture} 不得硬编码无 sandbox 启动`);
    assert.match(source, /browserLaunchContract/u, `${fixture} 必须使用统一浏览器启动契约`);
  }
});

test('023R1 foundation-events emits deterministic content-addressed font assets', async () => {
  const config = await read('examples/foundation-events/vite.config.js');
  assert.doesNotMatch(config, /assetFileNames:\s*['"]assets\/events-app\.\[ext\]['"]/u);
  assert.match(config, /name\.endsWith\(['"]\.css['"]\)\s*\?\s*['"]assets\/events-app\.css['"]\s*:\s*['"]assets\/\[name\]-\[hash\]\[extname\]['"]/u);
});
