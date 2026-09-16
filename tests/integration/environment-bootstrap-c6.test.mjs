import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';

test('C6 no-host-Node preparation requires exact approval and uses pinned archive bytes',{skip:!process.env.FOUNDATION_C6_NODE_ARCHIVE},()=>{
  const root=fs.mkdtempSync(path.resolve('.tmp/C6-no-node-')),archive=fs.realpathSync(process.env.FOUNDATION_C6_NODE_ARCHIVE);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'25495ff85bd89e2d8a24d88566d7e2f827c6b0d3d872b2cebf75371f93fcb1fe');
  const script=fs.readFileSync('distribution/summon-foundation/bin/prepare-environment.sh','utf8');
  const curl=root+'/fixture-curl.sh';fs.writeFileSync(curl,'#!/bin/sh\n[ "${C6_FAIL:-}" != yes ] || exit 7\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; dest=$1; fi; shift; done\n/bin/cp "$C6_ARCHIVE" "$dest"\n',{mode:0o700});
  // Only the network command is replaced in this isolated script. All approval,
  // hash, extraction, reinspection and filesystem checks are production code.
  const fixture=root+'/prepare.sh';fs.writeFileSync(fixture,script.replaceAll('/usr/bin/curl',curl));
  const env={PATH:'/nonexistent',TMPDIR:root,C6_ARCHIVE:archive},destination=root+'/private environment';
  const run=(...args)=>spawnSync('/bin/sh',[fixture,...args],{env,encoding:'utf8',timeout:60000});
  const inspected=run('--inspect',destination);assert.equal(inspected.status,0,inspected.stderr);assert(!fs.existsSync(destination));
  const plan=/计划摘要：([a-f0-9]{64})/.exec(inspected.stdout)?.[1];assert(plan);
  const refused=run('--prepare',destination,'wrong');assert.notEqual(refused.status,0);assert(!fs.existsSync(destination));
  const failedDestination=root+'/failed preparation',failedPlan=/计划摘要：([a-f0-9]{64})/.exec(run('--inspect',failedDestination).stdout)[1];
  const failed=spawnSync('/bin/sh',[fixture,'--prepare',failedDestination,failedPlan],{env:{...env,C6_FAIL:'yes'},encoding:'utf8'});
  assert.notEqual(failed.status,0);assert.match(fs.readFileSync(failedDestination+'/environment-result.txt','utf8'),/state=failed-or-interrupted/);assert(!fs.existsSync(failedDestination+'/node-v24.14.1-darwin-arm64'));
  const prepared=run('--prepare',destination,plan);assert.equal(prepared.status,0,prepared.stderr);
  const node=destination+'/node-v24.14.1-darwin-arm64/bin/node';
  const probe=spawnSync(node,['-p','JSON.stringify({version:process.version,executable:process.execPath,path:process.env.PATH})'],{env,encoding:'utf8'});
  assert.equal(probe.status,0);assert.deepEqual(JSON.parse(probe.stdout),{version:'v24.14.1',executable:node,path:'/nonexistent'});
  assert.match(fs.readFileSync(destination+'/environment-result.txt','utf8'),/state=prepared-and-rechecked/);
  assert.notEqual(run('--prepare',destination,plan).status,0);
  fs.writeFileSync(root+'/evidence.json',JSON.stringify({network:'fixture copies pinned official archive / controlled curl exit 7',approval:'engineering exact-plan fixture, not human',hostNodeOnPath:false,inspected,refused,failed,prepared,probe},null,2));
});
