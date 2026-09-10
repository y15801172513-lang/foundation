import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

import * as core from '@foundation/core';
import {auditDependencyDeclarations} from '../../scripts/dependency-declaration-audit.mjs';
import {auditUiGovernance} from '../../scripts/ui-governance-audit.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (file) => readFile(resolve(root, file), 'utf8');
const json = async (file) => JSON.parse(await read(file));

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function bareImports(source) {
  const imports = new Set();
  const expression = /(?:from\s*|import\s*\(|import\s*)['"]([^'".][^'"]*)['"]|require\(\s*['"]([^'".][^'"]*)['"]\s*\)/gu;
  for (const match of source.matchAll(expression)) {
    const specifier = match[1] || match[2];
    if (specifier && !specifier.startsWith('node:')) imports.add(packageName(specifier));
  }
  return [...imports].sort();
}

test('020R1 every Vite config and build entry owns each direct package import', async () => {
  assert.deepEqual(auditDependencyDeclarations().findings, []);
  const boundaries = [
    ['apps/management-center/package.json', ['apps/management-center/vite.config.js', 'apps/management-center/build.mjs']],
    ['examples/foundation-events/package.json', ['examples/foundation-events/vite.config.js']],
  ];
  for (const [manifestFile, entries] of boundaries) {
    const manifest = await json(manifestFile);
    const declared = new Set(Object.keys({...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies}));
    for (const entry of entries) {
      const imports = bareImports(await read(entry));
      assert.deepEqual(imports.filter((name) => !declared.has(name)), [], `${entry} has undeclared direct imports`);
    }
  }
});

test('020R1 example owns build-only tooling as exact devDependencies', async () => {
  const manifest = await json('examples/foundation-events/package.json');
  const expected = {
    '@tailwindcss/vite': '4.3.3',
    '@vitejs/plugin-react': '6.1.1',
    tailwindcss: '4.3.3',
    vite: '8.2.2',
  };
  assert.deepEqual(manifest.devDependencies, expected);
  for (const name of Object.keys(expected)) assert.equal(manifest.dependencies?.[name], undefined, `${name} is build tooling, not a runtime dependency`);
});

test('020R1 universal policy is machine-readable and separates product and specialist decisions', async () => {
  const policy = core.FOUNDATION_UI_POLICY;
  assert.equal(policy?.version, '020R1');
  assert.equal(policy?.newProjects?.mode, 'shadcn-first');
  assert.equal(policy?.existingProjects?.mode, 'preserve-and-inventory');
  assert.equal(policy?.unspecifiedPreset, 'installed-project-preset');
  assert.deepEqual(policy?.compositionOrder, ['local-shadcn-components', 'existing-variants', 'documented-custom-ui']);
  assert.equal(policy?.pageLayoutBoundary, 'external-layout-only');
  assert.equal(policy?.dependencyUpgradeRequiresExplicitAuthorization, true);
  assert.ok(Array.isArray(policy?.existingProjects?.classifications));

  const profileSource = await read('apps/management-center/src/foundation-ui-profile.mjs');
  assert.match(profileSource, /management-center/);
  assert.match(profileSource, /specialist-engine/);
  assert.match(profileSource, /React Flow/);
  assert.doesNotMatch(JSON.stringify(policy), /Management Center|React Flow/);
});

test('020R1 generated projects and task context consume the same policy record', () => {
  assert.equal(typeof core.foundationUiPolicyRecord, 'function');
  const project = {name: 'demo', projectId: 'project_demo', dataFormatVersion: '0.1.0', uiPolicy: core.foundationUiPolicyRecord('new')};
  const record = core.buildContextRecord({project, pages: [], relations: [], assets: []});
  assert.equal(record.uiPolicy.version, '020R1');
  assert.match(core.contextPlainText(record), /ui policy version: 020R1/);
  assert.match(core.contextPlainText(record), /ui governance mode: shadcn-first/);
});

test('020R1 current project stores its policy classification in foundation facts', async () => {
  const foundation = await json('examples/foundation-events/.foundation/foundation.json');
  assert.equal(foundation.uiPolicy?.version, '020R1');
  assert.equal(foundation.uiPolicy?.governanceMode, 'preserve-and-inventory');
  assert.equal(foundation.uiPolicy?.classification, 'existing-shadcn');
});

test('020R1 React Flow internals use an explicit specialist contract, not shadcn text or spacing tokens', async () => {
  const styles = await read('apps/management-center/src/styles.css');
  const start = styles.indexOf('.page-flow-node');
  const end = styles.indexOf('.relation-editor');
  const specialist = styles.slice(start, end);
  for (const token of [
    '--flow-node-header-gap:8px',
    '--flow-node-padding:12px',
    '--flow-node-title-size:15px',
    '--flow-node-meta-size:10px',
    '--flow-node-route-size:11px',
    '--flow-edge-label-size:10px',
  ]) assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(specialist, /var\(--text-(?:xs|sm|base|lg|xl|2xl)\)/);
  assert.doesNotMatch(specialist, /var\(--spacing\)/);
});

test('020R1 repeated product content uses semantic roles while primitive controls retain ownership', async () => {
  const expectedUsage = [
    ['apps/management-center/src/workspace/asset-management-workspace.jsx', ['PageTitle', 'PanelTitle', 'ContentDescription', 'MetadataText']],
    ['apps/management-center/src/workspace/asset-preview.jsx', ['SectionTitle', 'ContentDescription']],
    ['apps/management-center/src/features/context-panel/context-data-view.jsx', ['PanelTitle', 'SectionTitle', 'ContentDescription']],
    ['apps/management-center/src/features/context-panel/preview-sidebar.jsx', ['PanelTitle', 'SectionTitle', 'ContentDescription', 'CodeText']],
  ];
  for (const [file, roles] of expectedUsage) {
    const source = await read(file);
    for (const role of roles) assert.match(source, new RegExp(`<${role}\\b`), `${file} must render ${role}`);
  }

  const managementStyles = await read('apps/management-center/src/styles.css');
  const exampleStyles = await read('examples/foundation-events/src/styles.css');
  assert.doesNotMatch(managementStyles, /\[data-slot="(?:input|textarea|tabs-trigger|select-trigger|select-item|navigation-menu-link|dropdown-menu-item|dialog-title|empty-title|card-description|dialog-description|empty-description|field-description)"\][^{]*\{[^}]*font-size/);
  assert.doesNotMatch(exampleStyles, /\[data-slot="(?:input|textarea|tabs-trigger|select-trigger|select-item|dialog-title|empty-title|card-description|dialog-description|empty-description|field-description)"\][^{]*\{[^}]*@apply[^}]*text-/);
});

test('020R1 audit classifies every required scope and has no unapproved finding', async () => {
  const report = await auditUiGovernance();
  const classifications = new Set(report.findings.map((finding) => finding.classification));
  for (const classification of ['primitive-internal', 'product-content', 'external-layout', 'named-geometry', 'specialist-engine', 'approved-exception']) {
    assert.ok(classifications.has(classification), `missing audit classification: ${classification}`);
  }
  assert.deepEqual(report.blockingFindings, []);
  assert.ok(report.findings.some((finding) => finding.file === 'examples/foundation-events/src/bridge.mjs' && finding.approved), 'bridge findings must be checked by exact exception, not skipped wholesale');
});

test('020R1 topbar has separate identity, order, behavior, and narrow-overflow assertions', async () => {
  const source = await read('apps/management-center/src/workspace/workspace-app.jsx');
  const styles = await read('apps/management-center/src/styles.css');
  assert.match(source, /workspaceModel\.project\?\.name/);
  assert.match(source, /aria-label=\{workspaceModel\.project\?\.name/);
  const labels = ['预览搭建', '逻辑搭建', '资产管理'];
  const positions = labels.map((label) => source.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(source, /setBuildingMode\('preview'\)/);
  assert.match(source, /setBuildingMode\('logic'\)/);
  assert.match(source, /openAssets\(\)/);
  assert.match(source, /className="topbar-project[^\"]*truncate/);
  assert.match(styles, /\.topbar-navigation[^}]*overflow-x:auto/);
});
