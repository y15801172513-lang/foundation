import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {ROOT} from '../helpers/project-fixture.mjs';

test('React Flow 精确依赖仅属于管理中心，Tailwind 4 样式顶层顺序正确且构建含 selector', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  const centerPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/management-center/package.json')));
  assert.equal(centerPackage.dependencies['@xyflow/react'], '12.11.5');
  assert.equal(rootPackage.dependencies?.['@xyflow/react'], undefined);
  assert.equal(rootPackage.devDependencies?.['@xyflow/react'], undefined);
  const source = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  const logicWorkspace = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/information-logic-workspace.jsx'), 'utf8');
  const workspaceApp = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/workspace-app.jsx'), 'utf8');
  const tailwind = source.indexOf('@import "tailwindcss"');
  const shadcn = source.indexOf('@import "shadcn/tailwind.css"');
  const flow = source.indexOf('@import "@xyflow/react/dist/style.css"');
  assert.ok(tailwind >= 0 && shadcn > tailwind && flow > shadcn);
  assert.doesNotMatch(source.slice(0, source.indexOf('@source')), /@layer[^}]*@import "@xyflow\/react/s);
  assert.match(source, /\.logic-flow-canvas\s+\.react-flow__controls-button\s+svg\.lucide\s*\{[^}]*fill:none/);
  assert.match(workspaceApp, /<InformationLogicWorkspace[^>]*theme=\{theme\}/);
  assert.match(logicWorkspace, /<ReactFlow[^>]*colorMode=\{theme\}/);
  assert.match(logicWorkspace, /foundationTheme/);
  assert.match(source, /\.logic-flow-canvas\s+\.react-flow\s*\{[^}]*--xy-background-color-default:var\(--muted\)[^}]*--xy-controls-button-background-color-default:var\(--background\)[^}]*--xy-controls-button-color-default:var\(--foreground\)/s);
  assert.doesNotMatch(source, /\.page-thumbnail\s*\{[^}]*background:white/);
  const built = fs.readFileSync(path.join(ROOT, 'apps/management-center/dist/assets/workspace.css'), 'utf8');
  assert.match(built, /\.react-flow__/);
});

test('共享 Tabs 去除焦点描边并保留 line indicator，顶栏 NavigationMenu 使用标准菜单态', () => {
  const tabs = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/components/ui/tabs.jsx'), 'utf8');
  const eventTabs = fs.readFileSync(path.join(ROOT, 'examples/foundation-events/src/components/ui/tabs.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/workspace-app.jsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/components/ui/navigation-menu.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  assert.match(app, /NavigationMenu/);
  assert.doesNotMatch(app, /topbar-tabs|<Tabs/);
  assert.match(navigation, /@base-ui\/react\/navigation-menu/);
  assert.match(navigation, /rounded-lg/);
  assert.match(navigation, /hover:bg-muted/);
  assert.match(navigation, /data-active:bg-muted\/50/);
  assert.doesNotMatch(navigation, /after:absolute|data-active:after:opacity-100/);
  for (const source of [tabs, eventTabs]) {
    assert.match(source, /group-data-\[variant=line\]\/tabs-list:data-active:after:opacity-100/);
    assert.match(source, /focus-visible:after:opacity-100/);
    assert.match(source, /focus-visible:outline-none/);
    assert.doesNotMatch(source, /focus-visible:(?:border-ring|ring-|outline-1|outline-ring)/);
  }
  assert.match(styles, /\.topbar-navigation[^}]*min-width:0/);
});

test('全局边框默认值只存在于 base layer，不覆盖 shadcn 组件边框状态', () => {
  const styles = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  const baseLayerIndex = styles.indexOf('@layer base');
  assert.ok(baseLayerIndex > -1);
  assert.doesNotMatch(styles.slice(0, baseLayerIndex), /(?:^|\})\s*\*\s*\{[^}]*border-color\s*:/s);
  assert.match(styles.slice(baseLayerIndex), /@layer base\s*\{[\s\S]*?\*\s*\{[\s\S]*?@apply border-border outline-ring\/50/);

  const componentExpectations = [
    ['tabs.jsx', /border border-transparent/],
    ['button.jsx', /border border-transparent/],
    ['input.jsx', /border-input[\s\S]*focus-visible:border-ring[\s\S]*aria-invalid:border-destructive/],
    ['textarea.jsx', /border-input[\s\S]*focus-visible:border-ring[\s\S]*aria-invalid:border-destructive/],
    ['select.jsx', /border-input[\s\S]*focus-visible:border-ring[\s\S]*aria-invalid:border-destructive/],
    ['scroll-area.jsx', /border-t-transparent[\s\S]*border-l-transparent/],
  ];
  for (const [file, expectation] of componentExpectations) {
    const source = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/components/ui', file), 'utf8');
    assert.match(source, expectation, `${file} 应保留 shadcn 的语义边框状态`);
  }
});

test('预览工具栏直接从页面选择器开始，不显示冗余预览标题', () => {
  const toolbar = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/features/preview/preview-toolbar.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  assert.doesNotMatch(toolbar, /toolbar-title|>预览<\/span>/);
  assert.match(toolbar, /<div className="preview-toolbar">[\s\S]*<MetadataText className="toolbar-label">页面<\/MetadataText>/);
  assert.doesNotMatch(styles, /\.toolbar-title\s*\{/);
});

test('检查预览对象按钮位于面板默认 Tabs 左侧且不使用分隔线', () => {
  const source = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/features/context-panel/context-panel.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  assert.doesNotMatch(source, /import \{Separator\}|<Separator/);
  assert.doesNotMatch(source, /components\/ui\/button|<Button[\s>]/);
  assert.match(source, /<TabsList variant="default" className="context-panel-tab-list" aria-label="侧栏工作上下文"><TabsTrigger value="page">页面逻辑<\/TabsTrigger><TabsTrigger value="object">检查对象<\/TabsTrigger><\/TabsList>/);
  const actions = source.slice(source.indexOf('const actions ='), source.indexOf('const content ='));
  assert.doesNotMatch(actions, /检查预览对象|inspectorAction/);
  assert.ok(actions.indexOf('切换为悬浮') < actions.indexOf('最小化信息面板'));
  assert.match(source, /className="context-panel-leading">\{inspectorAction\}\{contextTabs\}/);
  assert.match(source, /className="context-panel-toolbar">\{contextHeader\}\{actions\}/);
  assert.doesNotMatch(styles, /\.context-panel-tab-list\[data-variant="line"\]/);
  assert.doesNotMatch(styles, /\.context-panel-toolbar \[data-slot="tabs-list"\][^{]*\{[^}]*width:100%/s);
  assert.match(styles, /\.context-panel-actions[^}]*margin-left:auto/);
  assert.match(styles, /\.panel-actions[^}]*margin-left:auto/);
});

test('未选择对象时复用最外围预览对象，不创建独立总览状态', () => {
  const app = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/workspace-app.jsx'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/features/context-panel/context-panel.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/features/context-panel/preview-sidebar.jsx'), 'utf8');
  const bridge = fs.readFileSync(path.join(ROOT, 'examples/foundation-events/src/bridge.mjs'), 'utf8');
  const inspectorContext = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/inspector-context.mjs'), 'utf8');
  assert.match(app, /inspectedObject: inspector\.phase === 'locked' \? inspector\.object : defaultInspectedObject/);
  assert.doesNotMatch(app, /previewObject|setPreviewObject/);
  assert.doesNotMatch(panel, /previewObject/);
  assert.doesNotMatch(sidebar, /object-preview|locked =|尚未锁定检查对象|展开下方分区|collapsed=\{collapsed\}/);
  assert.doesNotMatch(bridge, /previewOverview/);
  assert.doesNotMatch(inspectorContext, /previewOverview/);
});

test('上下文面板固定工具栏并仅让正文无滚动条地内部滚动', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/features/context-panel/context-panel.jsx'), 'utf8');
  const floating = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/features/context-panel/floating-context-panel.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  assert.match(panel, /<div className="context-panel-toolbar">\{contextHeader\}\{actions\}<\/div>\{content\}/);
  assert.match(floating, /<CardHeader className="panel-header">[\s\S]*?<\/CardHeader>\{children\}/);
  const floatingRule = styles.match(/div\[data-slot="card"\]\.floating-panel\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(floatingRule, /padding:0/);
  const bodyRule = styles.match(/\.panel-body\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(bodyRule, /display:flex/);
  assert.match(bodyRule, /min-height:0/);
  assert.match(bodyRule, /overflow:hidden/);
  const tabPanelRule = styles.match(/\.panel-body\s*>\s*\[data-slot="tabs-content"\]\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(tabPanelRule, /min-height:0/);
  assert.match(tabPanelRule, /overflow:hidden/);
  const scrollRule = styles.match(/\.panel-scroll\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(scrollRule, /min-height:0/);
  assert.match(scrollRule, /overflow:hidden/);
  assert.match(styles, /\.panel-scroll\s*>\s*\[data-slot="scroll-area-scrollbar"\]\s*\{\s*display:none/);
  assert.match(styles, /\.panel-scroll\s*\[data-slot="scroll-area-viewport"\][^{]*\{[^}]*scrollbar-width:none/);
  assert.match(styles, /\.panel-scroll\s*\[data-slot="scroll-area-viewport"\]::\-webkit-scrollbar\s*\{\s*display:none/);
  const treeRule = styles.match(/\.inspector-tree\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(treeRule, /min-height:calc\(var\(--spacing\) \* 24\)/);
  assert.match(treeRule, /overflow:auto/);
  assert.match(treeRule, /scrollbar-width:none/);
  assert.match(treeRule, /-ms-overflow-style:none/);
  assert.match(styles, /\.inspector-tree::\-webkit-scrollbar\s*\{\s*display:none/);
  const activeTreeItemRule = styles.match(/\.inspector-file-tree-button\[data-active="true"\]\s*\{[^}]*\}/s)?.[0] || '';
  assert.doesNotMatch(activeTreeItemRule, /background|border|box-shadow/, '文件树选中行不得自行增加底色或描边');
});
