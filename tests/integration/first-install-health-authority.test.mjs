import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
// Opt in only with a separately authorized, owned external test root. Never use
// a repository-contained staging directory: source authority masks this defect.
const root=process.env.FOUNDATION_ISOLATED_REPRO_ROOT,candidate=process.env.FOUNDATION_ISOLATED_CANDIDATE;
test('packaged health before current exists requires no source ancestor and grants no operation authority',{skip:!root||!candidate},()=>{
 assert.match(root,/^\/private\/tmp\/foundation-first-install-repro-[A-Za-z0-9]+$/);
 assert.equal(fs.realpathSync(root),root);const owner=JSON.parse(fs.readFileSync(root+'/ownership.json'));assert.equal(owner.purpose,'isolated first-install regression');
 assert(fs.realpathSync(candidate).startsWith(root+'/'));
 const work=fs.mkdtempSync(root+'/health-regression-');for(const name of ['app','runtime'])fs.cpSync(candidate+'/payload/'+name,work+'/'+name,{recursive:true});
 for(let p=work;;p=path.dirname(p)){assert(!fs.existsSync(p+'/state/current.json'));assert(!(fs.existsSync(p+'/.git')&&fs.existsSync(p+'/foundation-kit.json')));if(p===path.dirname(p))break;}
 const run=args=>spawnSync(work+'/runtime/bin/node',[work+'/app/packages/cli/index.mjs',...args],{cwd:work,env:{PATH:'',FOUNDATION_HEALTH_PROBE:'1'},encoding:'utf8',timeout:15000});
 const health=run(['--foundation-health']);assert.equal(health.status,0,health.stderr);assert.equal(JSON.parse(health.stdout).ok,true);assert.equal(JSON.parse(health.stdout).version,JSON.parse(fs.readFileSync(candidate+'/manifest.json')).productVersion);
 assert.equal(health.stdout.trim().split('\n').length,1);
 const authority=run(['manager','inspect','--root',work]);assert.notEqual(authority.status,0);assert.match(authority.stderr,/PLATFORM_AUTHORITY_UNAVAILABLE/);
 assert.notEqual(run(['--foundation-health','--root',work]).status,0);
 assert(!fs.existsSync(work+'/state'));fs.writeFileSync(work+'/evidence.json',JSON.stringify({health,authority},null,2));
});
