import {importedRenderMappings,radixAvatarForwarding} from './inspector-render-adapters.mjs';
import path from 'node:path';
import {inspectLocalLifecycle} from './lifecycle-manager.mjs';
import {captureProjectRoundInputs} from './project-context-round.mjs';
import {inspectorSyntax,inspectorSourceOwner} from './inspector-syntax.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {readFacts} from './facts.mjs';
import {inspectProjectStructure} from './project-coverage.mjs';
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256} from './install-contract.mjs';
// A proposal only: begin/create must issue births BEFORE source edits.
export function prepareInspectorUpgradePlan({project,installationRoot=null}) {
  const facts=readFacts(project),inventory=inspectProjectStructure(project,{installationRoot}),files=new Map(),actions=[],pending=[],syntaxFiles=new Map(),adapted=new Set();
  const sourceSyntax=file=>{
    if(!syntaxFiles.has(file))syntaxFiles.set(file,file.endsWith('.html')?null:inspectorSyntax(fs.readFileSync(resolveProjectFile(project,file),'utf8'),file));
    return syntaxFiles.get(file);
  };
  const localDefinition=(file,tag)=>{
    const parsed=sourceSyntax(file),imported=parsed?.imports.get(tag);
    let target=file,name=tag;
    if(imported){if(!imported.module.startsWith('.'))return null;const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),imported.module));target=inventory.sources.find(item=>[base,base+'.tsx',base+'.jsx',base+'/index.tsx'].includes(item.path))?.path;name=imported.export;}
    if(!target)return null;
    const definition=[...(sourceSyntax(target)?.definitions.values() || [])].find(item=>item.name===name);
    return definition?{file:target,...definition}:null;
  };
  for(const object of inventory.objects) {
    if(object.incarnation)continue;
    const text=fs.readFileSync(resolveProjectFile(project,object.file),'utf8');
    if(!syntaxFiles.has(object.file))syntaxFiles.set(object.file,object.file.endsWith('.html')?null:inspectorSyntax(text,object.file));
    const syntaxFile=syntaxFiles.get(object.file),syntax=syntaxFile?.objects.get(object.offset);
    const owner=inspectorSourceOwner(facts,object,syntax);
    if(!owner||syntaxFile&&!syntaxFile.valid) {
      pending.push({file:object.file,line:object.line,reason:'当前节点需要明确的源码定义归属或组件适配'});continue;
    }
    if(syntax?.repetition&&(!syntax.repetition.stable||!syntax.repetition.values)) {
      pending.push({file:object.file,line:object.line,reason:syntax.repetition.stable?'重复模板需实例绑定迁移': '此重复模板缺少稳定业务 key',keyExpression:syntax.repetition.keyExpression});continue;
    }
    const addEdit=edit=>{
      if(!files.has(object.file))files.set(object.file,{path:object.file,beforeSha256:sha256(text),edits:[]});
      files.get(object.file).edits.push(edit);
    };
    if(syntax?.repetition&&!object.attributes['data-foundation-instance-key']) {
      addEdit({offset:object.offset+1+object.tag.length,text:' data-foundation-instance-key={String('+syntax.repetition.keyExpression+')} data-foundation-instance-values={'+JSON.stringify(JSON.stringify(syntax.repetition.values))+'}'});
    }
    const called=localDefinition(object.file,object.tag);
    if(called&&!called.parameter&&inventory.objects.filter(call=>call.file===object.file&&call.tag===object.tag).length===1)continue;
    if(called?.parameter) {
      if(!object.attributes.foundationInstanceKey)addEdit({offset:object.offset+1+object.tag.length,text:' foundationInstanceKey='+JSON.stringify('instance-'+crypto.randomUUID())});
      continue;
    }
    const renderMaps=importedRenderMappings(project,text);
    const iconMapping=renderMaps.get(object.tag);
    const inputIcon=object.tag==='Icon'&&syntax?.definition&&text.includes('icon:Icon')?[...renderMaps.values()].filter(map=>new RegExp('icon=\\{'+map.name+'\\}').test(text)):[];
    const radixRoot=/^AvatarPrimitive\.(Root|Image|Fallback)$/u.test(object.tag)&&/import\s*\{\s*Avatar as AvatarPrimitive\s*\}\s*from\s*["']radix-ui["']/u.test(text)&&radixAvatarForwarding(project,object.tag.split('.')[1]);
    if(!/^[a-z][\w-]*$/u.test(object.tag)&&!iconMapping&&!inputIcon.length&&!radixRoot) {pending.push({file:object.file,line:object.line,tag:object.tag,reason:'外部组件需要核验属性转发和内部源码覆盖'});continue;}
    const maps=iconMapping?[iconMapping]:inputIcon;
    if(maps.length&&!object.attributes['data-foundation-render-map'])addEdit({offset:object.offset+1+object.tag.length,text:' data-foundation-render-map={'+JSON.stringify(JSON.stringify(maps))+'}'});
    const isComponent=facts.components.items.some(item=>item.id===owner.id)||Boolean(syntaxFile?.definitions.get(syntax?.definition?.anchor)?.parameter);
    if(isComponent) {
      const definition=syntaxFile?.definitions.get(syntax?.definition?.anchor);
      if(!definition?.parameter){pending.push({file:object.file,line:object.line,reason:'组件参数暂不支持精确实例属性适配'});continue;}
      const adaptation=object.file+':'+definition.anchor;
      if(!adapted.has(adaptation)) {
        adapted.add(adaptation);
        if(!definition.parameter.hasScope) {
          addEdit({offset:definition.parameter.offset,text:'foundationInstanceKey,'});
          if(definition.parameter.typeEnd)addEdit({offset:definition.parameter.typeEnd,text:' & {foundationInstanceKey?:string}'});
        }
      }
      if(syntax.root&&!object.attributes['data-foundation-instance-key'])addEdit({offset:object.offset+1+object.tag.length,text:' data-foundation-instance-key={foundationInstanceKey}'});
    }
    const objectId=object.persistentId || 'object-'+crypto.randomUUID();
    const action={kind:'create',objectId,ownerId:owner.id,sourceFile:object.file,...(object.instanceKey?{instanceKey:object.instanceKey}:{})};actions.push(action);
    if(!files.has(object.file))files.set(object.file,{path:object.file,beforeSha256:sha256(text),edits:[]});
    files.get(object.file).edits.push({offset:object.offset+1+object.tag.length,objectId,ownerId:action.ownerId,attributes:{...(!object.persistentId?{'data-foundation-object-id':objectId}:{}),'data-foundation-owner-id':action.ownerId,...(syntax?.definition?{'data-foundation-definition':syntax.definition.name}:{}),'data-foundation-incarnation':{from:'sync-round-begin',objectId}}});
  }
  const bridgeFiles=[];
  if(installationRoot){
    const state=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
    if(state.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||!state.project?.agreement)throw new Error('桥接升级材料需要健康安装及当前项目绑定');
    const artifactRoot=path.join(installationRoot,state.installation.current.appPath,'artifacts/preview');
    for(const input of captureProjectRoundInputs(project).files){
      const name=path.basename(input.path).replace(/^foundation-/u,'');
      if(!['preview-bridge.mjs','object-identity.mjs'].includes(name))continue;
      const artifact=path.join(artifactRoot,name);
      if(fs.realpathSync(artifact)!==artifact||!artifact.startsWith(fs.realpathSync(installationRoot)+path.sep))throw new Error('桥接材料路径不安全');
      const content=fs.readFileSync(artifact,'utf8');
      bridgeFiles.push({path:input.path,beforeSha256:input.sha256,afterSha256:sha256(content),content,state:input.sha256===sha256(content)?'current':'review-exact-replacement',preserve:'审阅当前副本差异；含用户修改时合并，不直接覆盖'});
    }
  }
  return {schemaVersion:'foundation-inspector-upgrade/1',projectId:facts.foundation.projectId,mutationPerformed:false,identityActions:actions,files:[...files.values()],pending,steps:['核对精确计划与项目源码写入授权','写前复核 beforeSha256；sync --round begin --identity-actions-json 提交本计划 actions','使用 begin 返回的 incarnation 注入属性；同文件按 offset 降序写入，保留其他字节','sync --round finish；重建预览；核对映射和运行；不得把 pending 标为完成'],bridge:{state:bridgeFiles.length?'exact-review-plan':'standard-runtime-or-no-copy',files:bridgeFiles,artifacts:['preview-bridge.mjs','object-identity.mjs'],preserve:'已修改副本必须审阅差异；不得静默覆盖或修改安装目录'},preserves:['project identity','facts IDs','bindings','user code','adoption exceptions']};
}
