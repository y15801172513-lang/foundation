import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {renderGitHubConversationalEntry} from '../../packages/core/conversational-entry-template.mjs';
import {validateCandidate} from '../../packages/core/candidate-package.mjs';

// Opt-in real published payload regression. Everything written stays in .tmp.
// OS account, source execution context and GitHub transport/proof are fixtures;
// the complete shell, bsdtar, archive/runtime bytes, CLI verification and HTTP
// confirmation page are real. No confirmation request is ever sent.
const repo = fs.realpathSync(path.resolve(import.meta.dirname, '../..'));
const assets = process.env.FOUNDATION_EXTRACTION_ASSETS;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const quote = x => `'${x.replaceAll("'", "'\\''")}'`;
test('030R6 full entry preserves bound modes under umask 077; old entry fails; tampering rejected', {skip: process.platform !== 'darwin' || process.arch !== 'arm64' || !assets}, async () => {
  const input = fs.realpathSync(assets);
  assert(input.startsWith(repo + '/.tmp/'));
  const catalog = JSON.parse(fs.readFileSync(path.join(input, 'foundation-release-0.2.1-macos-arm64.json')));
  const release = catalog.releases[0];
  // Historical private payload remains an explicit fixture. It is not the
  // current product's public acquisition identity.
  const historicalRepository = new URL(release.url).pathname.split('/').slice(1,3).join('/');
  const archive = path.join(input, path.basename(release.url));
  assert.equal(sha(fs.readFileSync(archive)), release.sha256);
  const old = fs.readFileSync(path.join(input, 'foundation-install-0.2.1-macos-arm64.sh'), 'utf8');
  assert.equal(sha(old), '30d6c093d812e3021e8abf4452da64cafc082e510f575777aafc0b3cff24f083');
  const work = fs.mkdtempSync(path.join(repo, '.tmp/030R6-shell-'));
  const results = [];
  for (const [name, original] of [['original', old], ['fixed', renderGitHubConversationalEntry(catalog,{repository:historicalRepository,repositoryId:release.repositoryId})]]) {
    const dir = path.join(work, name), home = path.join(dir, 'account');
    fs.mkdirSync(path.join(home, 'Library/Application Support'), {recursive: true});
    fs.mkdirSync(path.join(home, 'Library/Caches'));
    const destination = path.join(home, 'Foundation 用户 空格');
    const register = path.join(dir, 'register.mjs');
    fs.writeFileSync(path.join(dir, 'account.mjs'), `export function readCurrentPlatformAccount(){return {schemaVersion:'1.0.0',authority:'contained-account-fixture',platform:process.platform,uid:process.getuid(),gid:process.getgid(),username:'fixture',homedir:${JSON.stringify(home)}}}`);
    fs.writeFileSync(path.join(dir, 'loader.mjs'), `export async function resolve(s,c,n){const r=await n(s,c);return r.url.endsWith('/packages/cli/platform-account.mjs')?{url:new URL('./account.mjs',import.meta.url).href,shortCircuit:true}:r}`);
    fs.writeFileSync(register, `import{register}from'node:module';register(new URL('./loader.mjs',import.meta.url),{parentURL:import.meta.url});`);
    const client = path.join(dir, 'gh-fixture');
    fs.writeFileSync(client, `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(path.join(dir,'transport.jsonl'))},JSON.stringify(a)+'\\n');if(a[0]==='api'){const endpoint=a[3];if(endpoint.endsWith('/commits/v0.2.1'))console.log(${JSON.stringify(release.sourceCommit)});else if(endpoint.endsWith('/releases/tags/v0.2.1'))console.log('true');else if(endpoint===${JSON.stringify('repos/'+historicalRepository)})console.log(${JSON.stringify(String(release.repositoryId))});else process.exit(2);}else if(a[1]==='download'){fs.copyFileSync(${JSON.stringify(archive)},path.join(a[a.indexOf('--dir')+1],${JSON.stringify(path.basename(archive))}));}else if(a[1]==='verify-asset'){console.log(JSON.stringify({testTransportOnly:true}));}else process.exit(2);`, {mode:0o755});
    // Test-only three seams, recorded verbatim. No production switch, no tar,
    // digest, mode, runtime or candidate validator changes.
    const seams = [
      ['if [ -f "$script_parent/AGENTS.md" ] && [ -f "$script_parent/packages/core/trusted-authority.mjs" ]; then', 'if false; then'],
      ['$(/usr/bin/dscl . -read "/Users/$account" NFSHomeDirectory)', `$(/usr/bin/printf '%s\\n' ${quote('NFSHomeDirectory: '+home)})`],
      ['exec "$stage/candidate/foundation-kit" install --destination "$destination" --browser codex', `exec "$stage/candidate/payload/runtime/bin/node" --import ${quote(register)} "$stage/candidate/payload/app/packages/cli/index.mjs" install --destination "$destination" --browser codex`],
    ];
    let shell = original;
    for (const [from,to] of seams) {assert.equal(shell.split(from).length,2,from);shell=shell.replace(from,to);}
    fs.writeFileSync(path.join(dir,'test-seams.json'),JSON.stringify(seams,null,2));
    const file = path.join(dir,'entry.sh');fs.writeFileSync(file,shell);
    const child=spawn('/bin/sh',[file,'--version','0.2.1','--github-client',client,'--destination',destination],{cwd:dir,env:{...process.env,PATH:'',TMPDIR:dir,NODE_OPTIONS:''}});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    const done=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    try {
      const deadline=Date.now()+30000;
      while(child.exitCode===null&&!stdout.includes('AWAITING_FOUNDATION_UI_CONFIRMATION')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      const cache=path.join(home,'Library/Caches/ai-product-foundation-kit-acquisition');
      assert.equal(fs.statSync(cache).mode&0o777,0o700);
      const stage=path.join(cache,fs.readdirSync(cache)[0]);assert.equal(fs.statSync(stage).mode&0o777,0o700);
      const candidate=path.join(stage,'candidate');
      const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json')));
      const inventory=[{...manifest.launcher,path:'foundation-kit'},...manifest.files.map(x=>({...x,path:'payload/'+x.path}))];
      const modes=inventory.map(x=>{const p=path.join(candidate,x.path),s=fs.lstatSync(p),b=fs.readFileSync(p);assert(s.isFile()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7000,0);assert.equal(b.length,x.size);assert.equal(sha(b),x.sha256);return{path:x.path,expected:x.mode,actual:s.mode&0o777};});
      const checked=validateCandidate(candidate,{platform:'darwin',arch:'arm64',requireRuntime:true});
      assert(!fs.existsSync(destination));
      if(name==='original'){
        const exit=await done;assert.equal(exit.code,1);assert.match(stderr+stdout,/CANDIDATE_LAUNCHER_INVALID/);assert.equal(checked.ok,false);assert.equal(modes.filter(x=>x.expected!==x.actual).length,48);
      }else{
        assert(stdout.includes('AWAITING_FOUNDATION_UI_CONFIRMATION'),stderr+stdout);assert.equal(checked.ok,true,JSON.stringify(checked));assert(modes.every(x=>x.actual===x.expected));
        const match=stdout.match(/\{\s*"ok": true,[\s\S]*?\n\}/);assert(match,stdout);const ready=JSON.parse(match[0]);assert.equal(ready.installationRoot,destination);
        const response=await fetch(ready.url);assert.equal(response.status,200);const html=await response.text();fs.writeFileSync(path.join(dir,'plan.html'),html);assert(html.includes(destination));assert(html.includes('0.2.1'));assert(html.includes(ready.planId));assert(!fs.existsSync(destination));
        // Deliberate corruptions are confined to this new test extraction.
        const ordinary=inventory.find(x=>x.path.endsWith('package.json'));const p=path.join(candidate,ordinary.path);fs.chmodSync(p,0o600);const badMode=validateCandidate(candidate,{platform:'darwin',arch:'arm64',requireRuntime:true});assert.equal(badMode.error.code,'CANDIDATE_HASH_MISMATCH');fs.chmodSync(p,ordinary.mode);fs.appendFileSync(p,'x');const badBytes=validateCandidate(candidate,{platform:'darwin',arch:'arm64',requireRuntime:true});assert.equal(badBytes.error.code,'CANDIDATE_HASH_MISMATCH');fs.writeFileSync(path.join(dir,'negative-results.json'),JSON.stringify({badMode,badBytes},null,2));
      }
      results.push({name,modes,checked,confirmationSent:false,installed:false});
    } finally {
      if(child.exitCode===null)child.kill('SIGTERM');await done;fs.writeFileSync(path.join(dir,'stdout.log'),stdout);fs.writeFileSync(path.join(dir,'stderr.log'),stderr);fs.writeFileSync(path.join(work,'results.json'),JSON.stringify(results,null,2));
    }
  }
  console.log('030R6 evidence: '+path.relative(repo,work));
});
