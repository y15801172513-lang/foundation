import {runtimeObservationObjects} from './object-identity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sha256,canonicalStringify} from './install-contract.mjs';

// Only a just-restored, digest-verified transaction snapshot can supply this
// provenance. This does not infer continuity from equal user-controlled bytes.
export function rebindRestoredReferenceWitnesses({captured,operationId,snapshotHash}) {
 for(const scope of captured) {
  const saved=scope.records.find(record=>record.path==='.foundation/facts/project.json'&&record.type==='file');
  if(!saved)continue;
  const file=path.join(scope.root,saved.path),bytes=fs.readFileSync(file);
  if(sha256(bytes)!==saved.sha256)throw new Error('回滚身份记录已漂移，拒绝重新绑定');
  const project=JSON.parse(bytes),lifecycle=project.contextLifecycle;if(!lifecycle)continue;
  const restored=new Map(scope.records.filter(record=>record.type==='file').map(record=>[record.path,record]));
  const witness=(relative,hash)=>{
   const saved=restored.get(relative);if(!saved||saved.sha256!==hash)return null;
   const file=path.join(scope.root,relative),stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file||sha256(fs.readFileSync(file))!==hash)throw new Error('回滚源码身份已漂移，拒绝重新绑定');
   const value={dev:stat.dev,ino:stat.ino,birth:stat.birthtimeMs};
   return {identityPhysical:sha256(canonicalStringify(value)),physical:sha256(canonicalStringify({...value,ctime:stat.ctimeMs}))};
  };
  for(const record of [...(lifecycle.identities || []),...(lifecycle.objectReferences?.objects || []),...runtimeObservationObjects(lifecycle.objectReferences)]) {
   const current=witness(record.sourceFile || record.file,record.sourceSha256 || record.sha256);
   if(current){record.sourceIdentityPhysical=current.identityPhysical;record.sourcePhysical=current.physical;}
  }
  for(const input of lifecycle.lastObservation?.files || []){const current=witness(input.path,input.sha256);if(current)Object.assign(input,current);}
  lifecycle.restorations=[...(lifecycle.restorations || []),{operationId,snapshotHash,source:'verified-transaction-rollback'}];
  fs.writeFileSync(file,JSON.stringify(project,null,2)+'\n',{mode:saved.mode});
 }
}
