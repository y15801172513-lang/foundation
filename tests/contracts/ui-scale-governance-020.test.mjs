import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

import {auditUiGovernance} from '../../scripts/ui-governance-audit.mjs';

const root = resolve(import.meta.dirname, '../..');

test('020 product UI uses role typography and the Tailwind/shadcn spacing scale', async () => {
  const report = await auditUiGovernance();
  const prohibited = new Set([
    'rawFontPixels',
    'localSpaceTokens',
    'arbitraryTextClasses',
    'arbitrarySpacingClasses',
  ]);
  const findings = report.findings.filter((item) => item.scope === 'product' && prohibited.has(item.rule));
  assert.deepEqual(findings, []);
});

test('020 product CSS does not reintroduce hard-coded semantic colors', async () => {
  const report = await auditUiGovernance();
  const findings = report.findings.filter((item) => item.scope === 'product' && item.rule === 'hardcodedColors' && item.file !== 'examples/foundation-events/src/bridge.mjs');
  assert.deepEqual(findings, []);
});

test('020 governance contract documents approved geometry exceptions and content roles', async () => {
  const contract = await readFile(resolve(root, 'docs/FOUNDATION_SHADCN_TYPE_SPACING_GOVERNANCE_V01.md'), 'utf8');
  for (const token of ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs', 'font-mono', 'p-6', 'p-4', 'gap-6', 'gap-4', 'gap-2', 'gap-1', 'React Flow', 'floating panel', 'iframe']) {
    assert.match(contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('020 semantic content roles use the six approved shadcn Tailwind font-size tokens', async () => {
  const roles = await readFile(resolve(root, 'apps/management-center/src/components/foundation/content-roles.jsx'), 'utf8');
  const expectedRoles = [
    ['PageTitle', 'text-2xl'],
    ['PanelTitle', 'text-xl'],
    ['SectionTitle', 'text-lg'],
    ['ImportantText', 'text-base'],
    ['ContentDescription', 'text-xs'],
    ['MetadataText', 'text-xs'],
  ];

  for (const [role, token] of expectedRoles) {
    assert.match(roles, new RegExp(`function ${role}\\([\\s\\S]*?'[^']*\\b${token}\\b`), `${role} must use ${token}`);
  }
});

test('020 product surfaces map panel, section, body, control, and metadata roles consistently', async () => {
  const managementStyles = await readFile(resolve(root, 'apps/management-center/src/styles.css'), 'utf8');
  const previewStyles = await readFile(resolve(root, 'examples/foundation-events/src/styles.css'), 'utf8');
  const roleSurfaces = [
    ['apps/management-center/src/features/context-panel/preview-sidebar.jsx', ['PanelTitle', 'SectionTitle', 'ContentDescription', 'MetadataText', 'CodeText']],
    ['apps/management-center/src/features/context-panel/context-content.jsx', ['SectionTitle', 'ContentDescription']],
    ['apps/management-center/src/workspace/information-logic-workspace.jsx', ['PageTitle', 'PanelTitle', 'ImportantText', 'ContentDescription']],
    ['apps/management-center/src/workspace/asset-management-workspace.jsx', ['PageTitle', 'PanelTitle', 'SectionTitle', 'ContentDescription', 'MetadataText']],
  ];
  for (const [file, roles] of roleSurfaces) {
    const source = await readFile(resolve(root, file), 'utf8');
    for (const role of roles) assert.match(source, new RegExp(`<${role}\\b`));
  }
  assert.match(managementStyles, /\.page-flow-node h2[^}]*font-size:var\(--flow-node-title-size\)/);

  assert.match(previewStyles, /\.events-header p:not\(\.eyebrow\)[^{]*\{[^}]*text-xs/);
  assert.match(previewStyles, /\.event-card p[^{]*\{[^}]*text-xs/);
  assert.match(previewStyles, /\.event-detail h2[^{]*\{[^}]*text-lg/);
});

test('020 registry primitives do not use arbitrary font-size utilities', async () => {
  const report = await auditUiGovernance();
  const findings = report.findings.filter((item) => item.rule === 'arbitraryTextClasses');
  assert.deepEqual(findings, []);
});

test('020R1 shadcn semantic slots retain primitive-owned typography', async () => {
  const managementStyles = await readFile(resolve(root, 'apps/management-center/src/styles.css'), 'utf8');
  const previewStyles = await readFile(resolve(root, 'examples/foundation-events/src/styles.css'), 'utf8');
  assert.doesNotMatch(managementStyles, /\[data-slot="(?:input|textarea|tabs-trigger|select-trigger|dialog-title|card-description)"\][^{]*\{[^}]*font-size/);
  assert.doesNotMatch(previewStyles, /\[data-slot="(?:input|textarea|tabs-trigger|select-trigger|dialog-title|card-description)"\][^{]*\{[^}]*@apply[^}]*text-/);

  const input = await readFile(resolve(root, 'apps/management-center/src/components/ui/input.jsx'), 'utf8');
  const dialog = await readFile(resolve(root, 'apps/management-center/src/components/ui/dialog.jsx'), 'utf8');
  const card = await readFile(resolve(root, 'apps/management-center/src/components/ui/card.jsx'), 'utf8');
  assert.match(input, /text-sm/);
  assert.match(dialog, /data-slot="dialog-title"[\s\S]*?text-xl/);
  assert.match(dialog, /data-slot="dialog-title"[\s\S]*?leading-snug/);
  assert.match(card, /text-sm/);
});
