import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {ROOT} from '../helpers/project-fixture.mjs';

test('逻辑搭建和 React Flow 从管理中心首屏按工作区懒加载', () => {
  const source = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/workspace-app.jsx'), 'utf8');
  assert.doesNotMatch(source, /^import \{InformationLogicWorkspace\} from '\.\/information-logic-workspace';$/mu);
  assert.match(source, /lazy\(\(\) => import\('\.\/information-logic-workspace'\)/u);
  assert.match(source, /<Suspense fallback=\{<LogicWorkspaceLoading/u);
  assert.match(source, /import \{Spinner\} from '@\/components\/ui\/spinner'/u);
  assert.match(source, /data-foundation-loading="workspace"/u);
  assert.match(source, /<Spinner[^>]+aria-label=\{label\}/u);
  assert.match(source, /<WorkspaceChunkBoundary/u);
  assert.doesNotMatch(source, /^import \{AssetManagementWorkspace\} from '\.\/asset-management-workspace';$/mu);
  assert.match(source, /lazy\(\(\) => import\('\.\/asset-management-workspace'\)/u);
  assert.doesNotMatch(source, /^import \{PageBuildingWorkspace\} from '\.\/page-building-workspace';$/mu);
  assert.match(source, /lazy\(\(\) => import\('\.\/page-building-workspace'\)/u);
});

test('管理中心生产入口保持在 500 kB 以下并生成独立逻辑工作区 chunk', () => {
  const assets = path.join(ROOT, 'apps/management-center/dist/assets');
  const entry = path.join(assets, 'workspace.js');
  assert.ok(fs.statSync(entry).size < 500_000, '初始 workspace.js 必须低于 Vite 默认 500 kB advisory');
  const chunks = fs.readdirSync(path.join(assets, 'chunks')).filter((name) => name.endsWith('.js'));
  assert.ok(chunks.some((name) => name.startsWith('information-logic-workspace-')), '必须生成逻辑工作区动态 chunk');
});
