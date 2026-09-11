import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseSummonArgs} from '../../distribution/summon-foundation/lib/cli-options.mjs';
import {parseCliInvocation} from '../../packages/cli/command-contract.mjs';
import {renderInstallDestinationPage} from '../../packages/core/lifecycle-feedback.mjs';

test('035 default prepares, inspect is exclusive read-only, acquire remains explicit',()=>{
  assert.deepEqual(parseSummonArgs(['foundation']),{prepare:true});
  assert.deepEqual(parseSummonArgs(['foundation','--inspect']),{prepare:false,inspect:true});
  assert.deepEqual(parseSummonArgs(['foundation','--destination','/tmp/示例 空格']),{prepare:true,destination:'/tmp/示例 空格'});
  assert.equal(parseSummonArgs(['foundation','--prepare']).prepare,true);
  assert.equal(parseSummonArgs(['foundation','--acquire','--version','0.2.6']).prepare,false);
  for(const args of [['--inspect','--prepare'],['--inspect','--destination','/tmp/a'],['--acquire'],['--version'],['--inspect','--inspect'],['--yes'],['--acquire','--version','0.2.6','--destination','/tmp/a']])assert.throws(()=>parseSummonArgs(['foundation',...args]));
});
test('035 directory choice does not accept a competing destination or mutation flags',()=>{
  assert.equal(parseCliInvocation(['install','--choose-destination','--browser','codex']).options['--choose-destination'],true);
  for(const args of [['--choose-destination','--destination','/tmp/a'],['--choose-destination','--choose-destination'],['--choose-destination','--yes'],['--browser','unknown']])assert.throws(()=>parseCliInvocation(['install',...args]));
});
test('035 selection page discloses intent-only scope, escapes input, no command collection',()=>{
  const html=renderInstallDestinationPage({version:'0.2.7',suggestion:'/example/<script>"',acquisitionRoot:'/cache',bootstrapStateRoot:'/records',nonce:'a'.repeat(64),expiresAt:Date.now()+60000});
  assert.match(html,/查看安装计划/);assert.match(html,/不批准安装/);assert.match(html,/未注册 Skill/);
  assert.match(html,/&lt;script&gt;&quot;/);assert(!html.includes('/example/<script>'));
  assert(!html.includes('/__foundation/manager/confirm'));assert(!html.includes('指令帮助'));
  assert.match(html,/location.assign/);assert.match(html,/if\(busy\)return/);
});

test('035 full CLI no-TTY routes default to acquisition and held child, inspect never acquires',{skip:process.platform!=='darwin'||process.arch!=='arm64'},()=>{
  const repo=fs.realpathSync(path.resolve(import.meta.dirname,'../..')),work=fs.mkdtempSync(path.join(repo,'.tmp/cli-entry-035-'));
  const entry=new URL('../../distribution/summon-foundation/bin/summon.mjs',import.meta.url).href;
  // Test-only module dependencies simulate network, account and child execution.
  // Actual production CLI and parser bytes execute; no production switch is added.
  fs.writeFileSync(work+'/acquire.mjs',`import fs from'node:fs';export function plainPath(p){return p;}export function inspectRelease(){if(process.env.FAIL_NETWORK)throw Error('network fixture failure');return{version:'0.2.7',sourceCommit:'a'.repeat(40),documentationCommit:'b'.repeat(40),repository:{full_name:'y15801172513-lang/foundation'}};}export async function acquireRelease(c,s){fs.writeFileSync(s+'/acquired.json',JSON.stringify({simulation:true}));return{launcher:s+'/candidate/foundation-kit',installationConfirmed:false};}`);
  fs.writeFileSync(work+'/fs.mjs',`import fs from'node:fs';export default {...fs,existsSync(p){return String(p).endsWith('/AGENTS.md')?false:fs.existsSync(p)}};`);
  fs.writeFileSync(work+'/child.mjs',`import fs from'node:fs';import{spawn as real}from'node:child_process';export function spawnSync(c,a){if(c==='/usr/bin/id')return{status:0,stdout:'fixture\\n'};if(c==='/usr/bin/dscl')return{status:0,stdout:'NFSHomeDirectory: '+process.env.PROBE_HOME+'\\n'};if(a[0]==='onboarding')return{status:0,stdout:'--choose-destination'};throw Error('unexpected spawnSync');}export function spawn(c,a,o){fs.writeFileSync(process.env.PROBE_HOME+'/spawn.json',JSON.stringify({c,a,simulation:true}));return real(process.execPath,['-e',"console.log('TEST_CHILD_STARTED');setTimeout(()=>console.log('TEST_CHILD_ENDED_NO_INSTALL'),30)"],o);}`);
  fs.writeFileSync(work+'/loader.mjs',`export async function resolve(s,c,n){if(c.parentURL===${JSON.stringify(entry)}){const map={'../lib/acquire.mjs':'acquire.mjs','node:child_process':'child.mjs',...(process.env.SOURCE_GUARD_TEST?{}:{'node:fs':'fs.mjs'})};if(map[s])return{url:new URL(map[s],import.meta.url).href,shortCircuit:true};}return n(s,c);}`);
  fs.writeFileSync(work+'/register.mjs',`import{register}from'node:module';register(new URL('./loader.mjs',import.meta.url));`);
  const results=[];
  const invoke=(name,args,extra={})=>{const home=work+'/'+name;fs.mkdirSync(home);const r=spawnSync(process.execPath,['--import',work+'/register.mjs',new URL(entry).pathname,...args],{cwd:repo,env:{...process.env,NODE_OPTIONS:'',PATH:'',TMPDIR:work,PROBE_HOME:home,...extra},encoding:'utf8',timeout:5000});results.push({name,args,status:r.status,stdout:r.stdout,stderr:r.stderr});fs.writeFileSync(work+'/results.json',JSON.stringify(results,null,2));return{r,home};};
  const inspect=invoke('inspect',['foundation','--inspect']);assert.equal(inspect.r.status,0,inspect.r.stderr);assert.equal(JSON.parse(inspect.r.stdout).status,'RELEASE_DISCOVERED_NOT_ACQUIRED');assert.deepEqual(fs.readdirSync(inspect.home),[]);
  const normal=invoke('default',['foundation']);assert.equal(normal.r.status,0,normal.r.stderr);assert.match(normal.r.stdout,/TEST_CHILD_STARTED/);assert.match(normal.r.stdout,/TEST_CHILD_ENDED_NO_INSTALL/);assert(!normal.r.stdout.includes('RELEASE_DISCOVERED_NOT_ACQUIRED'));assert.deepEqual(JSON.parse(fs.readFileSync(normal.home+'/spawn.json')).a,['install','--choose-destination','--browser','codex']);
  const network=invoke('network',['foundation'],{FAIL_NETWORK:'1'});assert.equal(network.r.status,1);assert.deepEqual(fs.readdirSync(network.home),[]);
  const guard=invoke('guard',['foundation'],{SOURCE_GUARD_TEST:'1'});assert.equal(guard.r.status,1);assert.match(guard.r.stderr,/SOURCE_ONLY/);assert.deepEqual(fs.readdirSync(guard.home),[]);
});
