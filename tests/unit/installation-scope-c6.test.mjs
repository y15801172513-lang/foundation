import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareInstallationScope,verifyInstallationScope} from '../../packages/core/installation-scope.mjs';

test('C6 project scope binds a real repository independently of program location',()=>{
  const base=fs.mkdtempSync(path.resolve('.tmp/C6-scope-')),project=path.join(base,'Project A'),other=path.join(base,'Project B'),installationRoot=path.join(base,'Foundation A');
  fs.mkdirSync(project);fs.mkdirSync(other);
  execFileSync('/usr/bin/git',['init','--quiet',project]);
  const scope=prepareInstallationScope({kind:'project',projectRoot:project,installationRoot});
  assert.equal(scope.project.path,project);
  assert.deepEqual(verifyInstallationScope(scope,installationRoot,{cwd:project,project}),scope);
  assert.throws(()=>verifyInstallationScope(scope,installationRoot,{cwd:other}),{code:'INSTALL_SCOPE_OUTSIDE_PROJECT'});
  assert.throws(()=>verifyInstallationScope(scope,installationRoot,{project:other}),{code:'INSTALL_SCOPE_OTHER_PROJECT'});
  assert.throws(()=>prepareInstallationScope({kind:'project',projectRoot:other,installationRoot}),{code:'PROJECT_SKILL_SCOPE_UNVERIFIED'});
  assert.throws(()=>prepareInstallationScope({kind:'project',projectRoot:project,installationRoot:path.join(project,'runtime')}),{code:'INSTALL_SCOPE_DESTINATION_INVALID'});
  fs.renameSync(project,project+' retained');fs.mkdirSync(project);execFileSync('/usr/bin/git',['init','--quiet',project]);
  assert.throws(()=>verifyInstallationScope(scope,installationRoot),{code:'INSTALL_SCOPE_DRIFT'});
  assert.deepEqual(fs.readdirSync(other),[]);
});

test('C6 user scope does not accidentally adopt a project',()=>{
  assert.deepEqual(prepareInstallationScope(),{schemaVersion:'1.0.0',kind:'user',project:null});
  assert.throws(()=>prepareInstallationScope({kind:'user',projectRoot:'/example'}),{code:'INSTALL_SCOPE_INVALID'});
});
