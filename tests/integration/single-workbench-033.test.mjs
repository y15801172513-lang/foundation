import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createInstalledWorkbenchServer} from '../../apps/management-center/src/server/center-server.mjs';
import {enableProjectFixture} from '../helpers/authorized-project-fixture.mjs';
import {buildRepositoryCandidateForTest} from '../helpers/repository-candidate.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';
import {ROOT, EVENTS, makeTempDirectory, projectFixturePath, copyProjectFixture, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {conversationCommands} from '../../packages/core/conversation-commands.mjs';
import {parseCliInvocation} from '../../packages/cli/command-contract.mjs';
import {hashDirectory, createLifecyclePlan} from '@foundation/core';

async function start(t, options) {
  const server=createInstalledWorkbenchServer(options);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>server.close());return 'http://127.0.0.1:'+server.address().port;
}
test('033 installed empty workspace uses original content and no help bundle; read-only and binding failure closed',async t=>{
  const root=makeTempDirectory('033-workbench-');t.after(()=>removeTempDirectory(root));
  // Full product payload is required: the minimal transaction fixture has no
  // runtime descriptor and must not be accepted as a healthy workbench.
  const built=buildRepositoryCandidateForTest();
  const m=JSON.parse(fs.readFileSync(path.join(built.candidate,'manifest.json')));
  const installationRoot=path.join(root,'installed');
  const candidate={path:built.candidate,manifestHash:m.candidateHash,runtimeHash:m.files.find(x=>x.path===m.runtime.path).sha256,bytes:m.totalBytes,version:m.productVersion};
  applyLifecycleForTest(createLifecyclePlan({operation:'install',targetRoot:installationRoot,sandboxRoot:root,targetVersion:m.productVersion,candidate,now:Date.now()}));
  const before=hashDirectory(installationRoot);
  const url=await start(t,{installationRoot});
  const html=await(await fetch(url)).text();
  assert(!html.includes('installedHome'));assert(html.includes('"projectSelected":false'));assert(html.includes('"pages":[]'));
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  assert.equal(hashDirectory(installationRoot),before);
  const project=projectFixturePath(root,'明确项目');copyProjectFixture(EVENTS,project);
  assert.throws(()=>createInstalledWorkbenchServer({installationRoot,project}),/项目未接入/);
  enableProjectFixture(project,installationRoot);
  const projectBefore=hashDirectory(project);
  const selected=await start(t,{installationRoot,project});
  const page=await(await fetch(selected)).text();assert(page.includes('EventCard'));assert(!page.includes('installedHome'));assert.equal(hashDirectory(project),projectBefore);
  fs.renameSync(project,project+'-moved');
  assert.equal((await fetch(selected)).status,409);
  const current=path.join(installationRoot,'state/current.json');fs.renameSync(current,current+'.fixture-moved');
  assert.equal((await fetch(url)).status,409);
});
test('033 help remains a six-intent conversation catalog, not a frontend dependency',()=>{
  assert.equal(conversationCommands.length,6);
  assert.match(conversationCommands[0].purpose,/仅在对话/);
  assert.deepEqual(parseCliInvocation(['workbench','open','--root','/安装','--project','/项目']).route,['workbench','open']);
  const app=fs.readFileSync(path.join(ROOT,'apps/management-center/src/workspace/workspace-app.jsx'),'utf8');
  assert(!app.includes('CommandHelp'));assert(!app.includes('installedHome'));assert(app.includes('{content}'));
  const js=fs.readFileSync(path.join(ROOT,'apps/management-center/dist/assets/workspace.js'),'utf8');
  for(const forbidden of ['指令帮助','fd help','fd uninstall','installedHome'])assert(!js.includes(forbidden),forbidden);
  for(const preserved of ['dialog.jsx','button.jsx'])assert(fs.existsSync(path.join(ROOT,'apps/management-center/src/components/ui',preserved)));
});
