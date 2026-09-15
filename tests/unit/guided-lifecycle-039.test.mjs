import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeObservation} from '../../distribution/summon-foundation/lib/operation-result.mjs';
import {acquisitionProgress,downloadText} from '../../distribution/summon-foundation/lib/progress-page.mjs';
import {parseSummonArgs} from '../../distribution/summon-foundation/lib/cli-options.mjs';
import {matchesUninstallResult} from '../../distribution/summon-foundation/lib/maintenance-handoff.mjs';

test('039 uninstall receipt binds full body to live engine result, rejects altered scope and identity',()=>{
  const body={state:'uninstalled',installId:'installation-a',operationId:'operation-a',preserved:['user-data'],removed:['owned-runtime']};
  const receipt={...body,integrity:{algorithm:'hmac-sha256',hash:'a'.repeat(64)}};
  assert.equal(matchesUninstallResult(receipt,body,'installation-a'),true);
  for(const changed of [{...receipt,installId:'installation-b'},{...receipt,operationId:'other'},{...receipt,preserved:[]},{...receipt,removed:['user-data']},{...receipt,integrity:null}])assert.equal(matchesUninstallResult(changed,body,'installation-a'),false);
});

test('039 selected program success is not whole-flow success before Skill registration', () => {
  const observed = runtimeObservation({status:'BOOTSTRAP_OPERATION_ENDED',state:'completed',sessionId:'bootstrap-example',installationRoot:'/example/Foundation',journeyContext:{id:'same-flow',skillChoice:'selected'},result:{stableLauncherHealth:'passed'}});
  assert.equal(observed.terminal,false);
  assert.equal(observed.programState,'completed');
  assert.equal(observed.state,'awaiting-skill');
  const page = acquisitionProgress({operationId:'same-flow',...observed});
  assert.equal(page.terminal,false);
  assert.equal(page.journey.steps.find(step=>step.key==='program').state,'completed');
  assert.equal(page.journey.ended,false);
});

test('039 explicitly skipped Skill preserves completed program and ends selected flow', () => {
  const observed = runtimeObservation({status:'BOOTSTRAP_OPERATION_ENDED',state:'completed',sessionId:'bootstrap-example',journeyContext:{id:'same-flow',skillChoice:'skipped'},result:{stableLauncherHealth:'passed'}});
  assert.equal(observed.programState,'completed');
  assert.equal(observed.state,'completed');
  assert.equal(observed.terminal,true);
  assert.equal(acquisitionProgress({operationId:'same-flow',...observed}).journey.ended,true);
});

test('039 maintenance arguments are exclusive and preserve required explicit targets',()=>{
  assert.equal(parseSummonArgs(['foundation','--update','--root','/example/Folder','--version','0.2.11']).prepare,false);
  assert.equal(parseSummonArgs(['foundation','--uninstall','--root','/example/Folder']).uninstall,true);
  assert.equal(parseSummonArgs(['foundation','--resume','/example/result.json']).resume,'/example/result.json');
  for(const args of [['--update'],['--uninstall'],['--root','/a'],['--update','--root','/a'],['--uninstall','--root','/a','--version','0.2.11'],['--resume','/a','--uninstall'],['--update','--uninstall','--root','/a','--version','0.2.11']])assert.throws(()=>parseSummonArgs(['foundation',...args]));
});

test('039 download reports binary units and only proven denominators',()=>{
  assert.equal(downloadText({downloadedBytes:1048576,totalBytes:null}),'已接收 1.00 MiB（总量未知）');
  assert.match(downloadText({downloadedBytes:1048576,totalBytes:2097152}),/50%/);
  assert.doesNotMatch(downloadText({downloadedBytes:10,totalBytes:0}),/%/);
  assert.doesNotMatch(downloadText({downloadedBytes:20,totalBytes:10}),/%/);
  assert.equal(downloadText({downloadedBytes:-1}), '');
});

test('039 maintenance progress uses actual action rather than installation labels',()=>{
  for(const [kind,verb] of [['update','更新'],['uninstall','卸载']]){
    const p=acquisitionProgress({operationId:'maintenance',kind,state:'running',phase:'executing',installationWrites:'possible'});
    assert.equal(p.phase,'正在'+verb);assert.equal(p.nextLabel,'查看'+verb+'确认');
  }
  const p=acquisitionProgress({operationId:'update-partial',kind:'update',state:'partial',phase:'finished',terminal:true,programState:'completed'});
  assert.equal(p.title,'程序已更新，Skill 尚未更新');assert.equal(p.phase,'更新结果已返回');
});

test('039 uninstall has no download/install/discovery invitation; partial keeps program success',()=>{
  const page=acquisitionProgress({operationId:'uninstall-example',kind:'uninstall',state:'completed',terminal:true,phase:'finished',programState:'completed',maintenanceSteps:{remove:{state:'completed'},program:{state:'completed'}}});
  assert.equal(page.journey.title,'卸载完成');assert.deepEqual(page.journey.steps.map(s=>s.key),['remove','program']);assert.equal(page.nextUrl,null);assert.doesNotMatch(page.skill,/新对话/);
  const partial=acquisitionProgress({operationId:'partial-example',state:'partial',terminal:true,phase:'finished',programState:'completed',runtimeHealth:'passed',journeyContext:{skillChoice:'selected'},skillSteps:{material:{state:'completed'},register:{state:'cancelled'}},next:'程序完成，注册已取消'});
  assert.equal(partial.journey.ended,false);assert.equal(partial.journey.steps.find(s=>s.key==='program').state,'completed');assert.equal(partial.next,'程序完成，注册已取消');
});
