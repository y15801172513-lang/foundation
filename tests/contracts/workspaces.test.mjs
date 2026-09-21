import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as core from '@foundation/core';
import {ts} from 'ts-morph';
import * as managementCenter from '@foundation/management-center';
import * as cli from '@foundation/cli';
import {ROOT} from '../helpers/project-fixture.mjs';

function sourceFiles(directory) {
  return fs.readdirSync(directory, {recursive: true}).filter((name) => /\.(?:mjs|js|jsx)$/.test(name)).map((name) => path.join(directory, name));
}

test('三个真实 workspace 通过公开 exports 暴露职责', () => {
  assert.equal(typeof core.verify, 'function');
  assert.equal(typeof core.readPreviewConfig, 'function');
  assert.equal(typeof managementCenter.createManagementCenterServer, 'function');
  assert.equal(typeof managementCenter.workspaceDocument, 'function');
  assert.equal(typeof cli.runCli, 'function');
  for (const workspace of ['packages/core', 'packages/cli', 'apps/management-center']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, workspace, 'package.json')));
    assert.ok(manifest.name.startsWith('@foundation/'));
    assert.ok(manifest.exports);
  }
});

// Exact source-host consumers only; these capabilities never become package exports.
const hostImports = {
  "apps/management-center/src/server/center-server.mjs": [
    "applyProjectMutationPlan",
    "browserLaunchContract",
    "cleanupBrowser",
    "connectDevtools",
    "createWorkbenchRuntime",
    "evaluate",
    "inspectProjectAuthority",
    "inspectSyncSources",
    "openOrReuseWorkbench",
    "signTrustedPayload",
    "synchronizeProject",
    "waitForBrowserDevtoolsPort"
  ],
  "apps/management-center/src/server/preview-capability-observer.mjs": [
    "connectDevtools",
    "evaluate"
  ],
  "apps/management-center/src/server/workbench-snapshot.mjs": [
    "readWorkbenchAuthorityKey"
  ],
  "packages/cli/index.mjs": [
    "analyzeProjectSources",
    "analyzeSources",
    "discoverLaunchedCandidateRoot",
    "inspectProjectSync",
    "isLaunchedCandidate",
    "openOrReuseWorkbench",
    "prepareProjectSemanticReview",
    "readFirstInstallOperationStatus",
    "receiveJourneyTransport",
    "runFirstInstallBootstrap",
    "runFirstInstallDestinationSelection",
    "submitProjectSemanticReview",
    "synchronizeProject",
    "verifyProjectDefinition"
  ]
};
const managerConsumers = new Set(['packages/cli/index.mjs', 'apps/management-center/src/server/center-server.mjs']);
function crossingAllowed(file, specifier, names) {
  const target = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT,file)),specifier)).replaceAll(path.sep,'/');
  const owner = value => ['packages/core/','packages/cli/','apps/management-center/'].find(prefix=>value.startsWith(prefix));
  if (!specifier.startsWith('.') || !owner(target) || owner(file)===owner(target)) return true;
  if (target==='packages/core/workspace-host.mjs') return names.length>0 && names.every(name=>hostImports[file]?.includes(name));
  return target==='packages/core/lifecycle-manager-host.mjs' && managerConsumers.has(file) && names.length>0 && names.every(name=>file==='packages/cli/index.mjs' ? ['createLocalLifecycleManagerServerForPlanRef','createInstalledOverviewServer'].includes(name) : name==='createLocalLifecycleManagerServer');
}

test('workspace 使用公开 API，只有精确宿主入口可以调用私有能力', () => {
  const workspaceFiles = [...sourceFiles(path.join(ROOT, 'packages')), ...sourceFiles(path.join(ROOT, 'apps/management-center/src'))];
  for (const file of workspaceFiles) {
    const relative=path.relative(ROOT,file).replaceAll(path.sep,'/');
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const visit=node=>{
      let specifier=null,names=[];
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) {
        specifier=node.moduleSpecifier?.text;
        const bindings=ts.isImportDeclaration(node)?node.importClause?.namedBindings:node.exportClause;
        if(bindings && (ts.isNamedImports(bindings)||ts.isNamedExports(bindings)))names=bindings.elements.map(item=>(item.propertyName || item.name).text);
      } else if(ts.isCallExpression(node) && (node.expression.kind===ts.SyntaxKind.ImportKeyword || node.expression.getText(source)==='require') && ts.isStringLiteral(node.arguments[0]))specifier=node.arguments[0].text;
      if(specifier) assert(crossingAllowed(relative,specifier,names),relative+': '+specifier);
      ts.forEachChild(node,visit);
    };visit(source);
  }
  const cliSource = fs.readFileSync(path.join(ROOT, 'packages/cli/index.mjs'), 'utf8');
  for (const forbidden of ["'/home'", "'/detail'", 'src/app.mjs', 'src/pages.mjs', 'src/button.mjs']) assert.ok(!cliSource.includes(forbidden), forbidden);
});

test('registry 层不承载 Foundation feature 定制，源码不新增危险执行入口', () => {
  const uiDirectory = path.join(ROOT, 'apps/management-center/src/components/ui');
  for (const file of sourceFiles(uiDirectory)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('context-panel') && !source.includes('floating-panel') && !source.includes('workspace-'), file);
  }
  const checked = [...sourceFiles(path.join(ROOT, 'apps/management-center/src')), ...sourceFiles(path.join(ROOT, 'examples/button-two-page/src'))];
  for (const file of checked) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('innerHTML') && !source.includes('eval(') && !source.includes('new Function('), file);
  }
});

test('管理中心目录职责清晰且状态只有一个源码权威', () => {
  for (const required of ['components/foundation/icon-button.jsx', 'features/preview/preview-canvas.jsx', 'features/context-panel/context-panel.jsx', 'state/workspace-state.mjs', 'server/center-server.mjs', 'workspace/workspace-app.jsx']) assert.ok(fs.existsSync(path.join(ROOT, 'apps/management-center/src', required)), required);
  const stateFiles = fs.readdirSync(path.join(ROOT, 'apps/management-center'), {recursive: true}).filter((name) => name.endsWith('workspace-state.mjs')).map((name) => name.replaceAll(path.sep, '/'));
  assert.deepEqual(stateFiles, ['src/state/workspace-state.mjs']);
});

test('宿主例外不能扩散到浏览器、namespace、其他私有模块或公开 exports',()=>{
  assert.equal(crossingAllowed('apps/management-center/src/workspace/workspace-app.jsx','../../../../packages/core/workspace-host.mjs',['signTrustedPayload']),false);
  assert.equal(crossingAllowed('apps/management-center/src/server/center-server.mjs','../../../../packages/core/workspace-host.mjs',[]),false);
  assert.equal(crossingAllowed('packages/cli/index.mjs','../core/trusted-authority.mjs',['signTrustedPayload']),false);
  for(const name of ['signTrustedPayload','readWorkbenchAuthorityKey','applyProjectMutationPlan'])assert.equal(core[name],undefined);
  const exports=JSON.parse(fs.readFileSync(path.join(ROOT,'packages/core/package.json'))).exports;
  assert(!Object.values(exports).some(value=>value.includes('workspace-host')));
});
