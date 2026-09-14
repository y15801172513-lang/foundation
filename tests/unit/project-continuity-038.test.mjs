import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {makeTempDirectory} from '../helpers/project-fixture.mjs';
import {FACT_FILES,emptyFact} from '../../packages/core/facts.mjs';
import {sha256} from '../../packages/core/install-contract.mjs';
import {inspectProjectDeliveryFiles} from '../../packages/core/project-delivery.mjs';
import {deriveClosedHandlerBinding} from '../../packages/core/project-mutation-handlers.mjs';
import {parseCliInvocation} from '../../packages/cli/command-contract.mjs';

// Deterministic unit fixture, not a natural enable/adopt or human acceptance.
function fixture(){
  const root=makeTempDirectory('038-delivery-unit-');
  fs.mkdirSync(path.join(root,'.foundation/facts'),{recursive:true});fs.mkdirSync(path.join(root,'.foundation/identity'));
  for(const kind of FACT_FILES)fs.writeFileSync(path.join(root,`.foundation/facts/${kind}.json`),JSON.stringify(emptyFact(kind)));
  fs.writeFileSync(path.join(root,'.foundation/identity/project.json'),JSON.stringify({schemaVersion:'1.0.0',projectId:'project_unit',projectKind:'existing'}));
  fs.writeFileSync(path.join(root,'home.html'),'<main>isolated unit page</main>');
  return root;
}
const read=(root,relative)=>fs.readFileSync(path.join(root,relative));
const changes=root=>[{path:'home.html',sha256:sha256(read(root,'home.html'))}];
function batch(root){return {scope:'登记隔离单元页面',generatedAt:'2026-09-14T00:00:00Z',sources:changes(root),documents:[{kind:'pages',expectedSha256:sha256(read(root,'.foundation/facts/pages.json')),upserts:[{id:'page_home',name:'首页',status:'active',source:'engineering-unit',entry:true,preview:'/',verificationStatus:'unverified',implementationMapping:'home.html'}]}]};}
function materialized(payload){const item=payload.documents[0].upserts[0];return {path:'.foundation/facts/pages.json',content:JSON.stringify({...emptyFact('pages'),items:[{...item,implementationSha256:payload.sources[0].sha256,updatedAt:payload.generatedAt}]},null,2)+'\n'};}
test('038 source only is not delivery; confirmed batch materialization binds digest, external edit is rereadable stale',()=>{
  const root=fixture();
  const check=()=>inspectProjectDeliveryFiles({project:root,changes:changes(root)});
  assert.equal(check().state,'sync-pending');assert(check().issues.some(x=>x.code==='SOURCE_NOT_REGISTERED'));
  const before=read(root,'.foundation/facts/pages.json');
  const derived=deriveClosedHandlerBinding({operation:'asset-facts-batch',project:root,handlerPayload:batch(root)});
  // Derived plan is read-only: represents cancel/not yet confirmed.
  assert.deepEqual(read(root,'.foundation/facts/pages.json'),before);assert.equal(check().state,'sync-pending');
  const document=materialized(batch(root));assert.equal(derived.actions[0].documents[0].sha256,sha256(document.content));assert.equal(JSON.parse(document.content).items[0].implementationSha256,changes(root)[0].sha256);
  fs.writeFileSync(path.join(root,document.path),document.content); // unit materialization, not production apply
  assert.equal(check().state,'consistent');
  assert.equal(inspectProjectDeliveryFiles({project:root,changes:changes(root),requirePreview:true}).state,'sync-pending');
  fs.appendFileSync(path.join(root,'home.html'),'edited');assert(check().issues.some(x=>x.code==='SOURCE_STALE'));assert.equal(check().state,'sync-pending');
  const old=changes(root);fs.appendFileSync(path.join(root,'home.html'),'again');assert(inspectProjectDeliveryFiles({project:root,changes:old}).issues.some(x=>x.code==='CHANGE_INPUT_STALE'));
});
test('038 rename removes only exact records, preserves source, rejects dangling references and paths',()=>{
  const root=fixture();const initial=materialized(batch(root));fs.writeFileSync(path.join(root,initial.path),initial.content);
  const payload=batch(root);
  fs.renameSync(path.join(root,'home.html'),path.join(root,'renamed.html'));
  assert.equal(inspectProjectDeliveryFiles({project:root,changes:[{path:'home.html',sha256:null},{path:'renamed.html',sha256:sha256(read(root,'renamed.html'))}]}).state,'sync-pending');
  payload.sources=[{path:'renamed.html',sha256:sha256(read(root,'renamed.html'))}];
  payload.documents[0].removes=['page_home'];payload.documents[0].upserts[0].id='page_renamed';payload.documents[0].upserts[0].implementationMapping='renamed.html';
  const fixed=deriveClosedHandlerBinding({operation:'asset-facts-batch',project:root,handlerPayload:payload});
  const final=materialized(payload);assert.equal(fixed.actions[0].documents[0].sha256,sha256(final.content));assert.deepEqual(fixed.deletes,[]);fs.writeFileSync(path.join(root,final.path),final.content);
  assert.equal(inspectProjectDeliveryFiles({project:root,changes:[{path:'home.html',sha256:null},...payload.sources]}).state,'consistent');assert(fs.existsSync(path.join(root,'renamed.html')));
  assert.throws(()=>inspectProjectDeliveryFiles({project:root,changes:[{path:'../outside',sha256:null}]}));
  payload.documents[0].expectedSha256=sha256(read(root,'.foundation/facts/pages.json'));payload.documents[0].removes=['missing'];assert.throws(()=>deriveClosedHandlerBinding({operation:'asset-facts-batch',project:root,handlerPayload:payload}));
});
test('038 public CLI parses explicit delivery inputs and rejects invented mutation route',()=>{
  assert.deepEqual(parseCliInvocation(['project','delivery-check','--root','/install','--project','/project','--changes-json','[]','--require-preview']).route,['project','delivery-check']);
  assert.throws(()=>parseCliInvocation(['project','delivery-apply','--project','/project']));
});
