import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createJourneyControl} from '../../distribution/summon-foundation/lib/journey-control.mjs';
import {isJourneyRequest} from '../../packages/core/journey-transport.mjs';

test('040 transport identity is not a confirmation and requires all three bindings',()=>{
  const transport={origin:'http://127.0.0.1:43123',operationId:'operation-a',token:'a'.repeat(64)};
  const headers={origin:transport.origin,'x-foundation-operation':transport.operationId,'x-foundation-journey':transport.token};
  assert.equal(isJourneyRequest({headers},transport),true);
  for(const key of Object.keys(headers))assert.equal(isJourneyRequest({headers:{...headers,[key]:'wrong'}},transport),false);
  assert.equal(isJourneyRequest({headers},null),false);
});

test('040 directory intent is once-only and cannot stand in for a plan confirmation',async()=>{
  const parent=fs.mkdtempSync(path.resolve('.tmp/C6-choice-')),destination=path.join(parent,'Foundation');
  const control=createJourneyControl(()=>({operationId:'one'}),()=>{});
  control.setOrigin('http://127.0.0.1:43123');
  const selected=control.waitChoice();
  await assert.rejects(control.submit({operationId:'two',action:'choose',destination:'/example',skillChoice:'skipped'}),/身份/);
  assert.equal((await control.submit({operationId:'one',action:'choose',destination,skillChoice:'skipped'})).status,200);
  const choice=await selected;
  assert.equal(choice.destination,destination);assert.equal(choice.skillChoice,'skipped');assert.equal(choice.scopeKind,'user');assert.equal(choice.projectRoot,null);assert(choice.destinationCheck.availableBytes>0);assert(!fs.existsSync(destination));
  await assert.rejects(control.submit({operationId:'one',action:'choose',destination:'/other',skillChoice:'selected'}),/没有可确认/);
  await assert.rejects(control.submit({operationId:'one',action:'confirm'}),/没有可确认/);
});

test('040 fixed child route retains real browser Origin and rejects wrong or retired plans',async()=>{
  let sent,posts=0;
  const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.send=message=>{sent=message;};
  const session={sessionId:'session-a',planHash:'hash-a',state:'pending'};
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.origin,'http://127.0.0.1:43123');
    assert.equal(req.headers['x-foundation-journey'],sent.token);
    assert.equal(req.headers['x-foundation-operation'],'one');
    res.setHeader('content-type','application/json');
    if(req.url==='/__foundation/manager/view')res.end(JSON.stringify({operationId:'one',session,managerNonce:'nonce',action:'apply'}));
    else if(req.url==='/__foundation/manager/confirm'){
      let raw='';for await(const chunk of req)raw+=chunk;
      assert.deepEqual(JSON.parse(raw),{operationId:'one',sessionId:'session-a',planHash:'hash-a',managerNonce:'nonce',action:'apply'});
      posts++;res.end(JSON.stringify({state:'completed'}));
    }else res.writeHead(404).end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const control=createJourneyControl(()=>({operationId:'one'}),()=>{});
    control.setOrigin('http://127.0.0.1:43123');control.attach(child);child.emit('message',{type:'foundation-journey-ready-v1'});
    assert.equal(sent.type,'foundation-journey-bind-v1');assert.equal('action' in sent,false);
    await control.observe(child,{status:'AWAITING_FOUNDATION_UI_CONFIRMATION',url:`http://127.0.0.1:${server.address().port}/`,sessionId:session.sessionId});
    const body={operationId:'one',sessionId:'session-a',planHash:'hash-a',managerNonce:'nonce',action:'apply'};
    for(const key of ['operationId','sessionId','planHash','managerNonce','action'])await assert.rejects(control.submit({...body,[key]:'wrong'}));
    assert.equal(posts,0);
    const access=fs.accessSync;
    fs.accessSync=(file,...rest)=>{if(['/usr/bin/curl','/usr/bin/tar','/usr/bin/shasum'].includes(file))throw Error('isolated unavailable download tool');return access(file,...rest);};
    try{assert.equal((await control.submit(body)).body.state,'completed');assert.equal(posts,1);}finally{fs.accessSync=access;}
    child.exitCode=0;child.emit('close');assert.equal(control.view(),null);
    await assert.rejects(control.submit(body),/没有可确认/);assert.equal(posts,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('040 unconfirmed directory cancellation and expiry terminate without an execution plan',async()=>{
  for(const cancel of [true,false]){
    const control=createJourneyControl(()=>({operationId:'one'}),()=>{});
    control.setOrigin('http://127.0.0.1:43123');
    const pending=control.waitChoice({timeoutMs:cancel?1000:5});
    const rejected=assert.rejects(pending,e=>e.code===(cancel?'ENTRY_CHOICE_CANCELLED':'ENTRY_CHOICE_EXPIRED'));
    if(cancel)assert.equal((await control.submit({operationId:'one',action:'cancel-intent'})).body.state,'cancelled-no-install');
    await rejected;assert.equal(control.view(),null);
    await assert.rejects(control.submit({operationId:'one',action:'choose',destination:'/unused',skillChoice:'skipped'}),/没有可确认/);
  }
});

test('C7 fresh selection rejects project intent instead of silently downgrading; cancellation stays independent',async()=>{
  const bodies=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.method==='GET')return res.end(JSON.stringify({operationId:'one',nonce:'nonce'}));
    let raw='';for await(const chunk of req)raw+=chunk;
    bodies.push(JSON.parse(raw));res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const child=new EventEmitter();child.exitCode=null;child.send=()=>{};
    const control=createJourneyControl(()=>({operationId:'one'}),()=>{});
    control.setOrigin('http://127.0.0.1:43123');control.attach(child);
    await control.observe(child,{status:'AWAITING_FOUNDATION_DIRECTORY_SELECTION',url:`http://127.0.0.1:${server.address().port}/`});
    await control.submit({operationId:'one',action:'select',destination:'/fixture',skillChoice:'skipped'});
    for(const invalid of [{scopeKind:'project',projectRoot:'/project'},{scopeKind:'user',projectRoot:'/project'},{scopeKind:'other'}])await assert.rejects(control.submit({operationId:'one',action:'select',destination:'/fixture',skillChoice:'skipped',...invalid}),/不接受项目范围/);
    await control.submit({operationId:'one',action:'cancel',scopeKind:'project',projectRoot:'/project'});
    assert.deepEqual(bodies,[{nonce:'nonce',action:'select',destination:'/fixture',skillChoice:'skipped'},{nonce:'nonce',action:'cancel'}]);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
