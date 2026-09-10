import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {thirdPartyNotices} from '../../scripts/third-party-notices.mjs';
const root=fs.realpathSync(new URL('../..',import.meta.url));
test('actual dependency notices deterministic and exclude builder paths',()=>{
 const inputs=['node_modules/react/index.js','node_modules/@fontsource-variable/geist/package.json'];
 const result=thirdPartyNotices(inputs,root);assert.equal(result,thirdPartyNotices([...inputs].reverse(),root));assert.match(result,/react@/);assert.match(result,/SIL OPEN FONT LICENSE/);assert(!result.includes(root));
});
test('missing license and symlink license fail closed',()=>{
 const temp=fs.mkdtempSync(path.join(root,'.tmp','license-034-')),pkg=path.join(temp,'node_modules','fixture');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));
 assert.throws(()=>thirdPartyNotices([path.join(pkg,'package.json')],temp),/完整许可/);
 fs.symlinkSync(path.join(root,'node_modules/react/LICENSE'),path.join(pkg,'LICENSE'));
 assert.throws(()=>thirdPartyNotices([path.join(pkg,'package.json')],temp),/普通文件/);
});
