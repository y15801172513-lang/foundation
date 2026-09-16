import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {classifyEntryEnvironment,inspectEntryEnvironment,inspectEntryDestination,inspectScopeIntent} from '../../distribution/summon-foundation/lib/environment-check.mjs';
test('C6 environment classification never prepares dependencies or pretends unsupported platforms are repairable',()=>{
  const base={platform:'darwin',arch:'arm64',nodeVersion:'24.14.1',tools:[{path:'/usr/bin/curl',available:true}]};
  assert.equal(classifyEntryEnvironment(base).state,'ready');
  for(const nodeVersion of ['', '20.19.0','22.8.0'])assert.equal(classifyEntryEnvironment({...base,nodeVersion}).state,'environment-required');
  for(const platform of ['win32','linux'])assert.equal(classifyEntryEnvironment({...base,platform}).state,'unsupported');
  assert.equal(classifyEntryEnvironment({...base,arch:'x64'}).state,'unsupported');
  assert.equal(classifyEntryEnvironment({...base,tools:[{path:'/missing',available:false}]}).state,'blocked');
});
test('C6R1 checks actual action tools: missing download tools do not block confirmed local work',()=>{
  const access=fs.accessSync;
  fs.accessSync=(file,...rest)=>{if(['/usr/bin/curl','/usr/bin/tar','/usr/bin/shasum'].includes(file))throw Error('isolated missing tool');return access(file,...rest);};
  try{
    for(const purpose of ['confirm','uninstall','resume']){const result=inspectEntryEnvironment({purpose});assert.equal(result.state,'ready');assert.deepEqual(result.tools,[]);assert.equal(result.purpose,purpose);}
    assert.deepEqual(inspectEntryEnvironment({purpose:'discover'}).missing,['/usr/bin/curl']);
    const acquire=inspectEntryEnvironment({purpose:'acquire'});assert.equal(acquire.state,'blocked');assert.deepEqual(acquire.missing,['/usr/bin/curl','/usr/bin/tar']);
    assert.throws(()=>inspectEntryEnvironment({purpose:'unknown'}));
  }finally{fs.accessSync=access;}
});
test('C6 destination preflight preserves unknown contents and scope errors without writes',()=>{
  const root=fs.mkdtempSync(path.resolve('.tmp/C6-environment-')),target=root+'/目标 空格';
  assert.equal(inspectEntryDestination('"'+target+'"').destination,target);assert(!fs.existsSync(target));
  fs.mkdirSync(target);fs.writeFileSync(target+'/keep','unchanged');
  assert.throws(()=>inspectEntryDestination(target),/已有内容/);assert.equal(fs.readFileSync(target+'/keep','utf8'),'unchanged');
  fs.symlinkSync(target,root+'/linked');assert.throws(()=>inspectEntryDestination(root+'/linked'));
  assert.throws(()=>inspectScopeIntent('project',root,target),/不接受项目范围/);
  assert.throws(()=>inspectScopeIntent('user',root,target),/不接受项目范围/);
  assert.deepEqual(inspectScopeIntent('user',null,target),{kind:'user',projectRoot:null});
});
