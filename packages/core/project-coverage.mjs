import {sourceSemanticDigest} from './source-syntax.mjs';
import {deriveSourceSemantics} from './source-semantics.mjs';
import {reconcileObjectHistory} from './object-identity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {inspectLocalLifecycle} from './lifecycle-manager.mjs';
import {createRequire} from 'node:module';
import {inspectSyncSources} from './source-inventory.mjs';
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';

// Independent implementation inventory, never a semantic verifier. Tokens are
// source locations within these bytes; only explicit IDs can persist across edits.
const inventories=new Map();
export function inspectProjectStructure(project,{installationRoot=null}={}) {
  const sources=inspectSyncSources(project),objects=[],obligations=[],programs=[],semanticSources=[],limitations=[];
  const runtimeSources=[];
  if(installationRoot) {
    const state=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
    if(state.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||!state.project?.agreement)throw new Error('语义运行时分类需要健康安装与当前项目绑定');
    const artifactRoot=path.join(installationRoot,state.installation.current.appPath,'artifacts/preview');
    for(const name of ['preview-bridge.mjs','object-identity.mjs']) {
      const artifact=path.join(artifactRoot,name);
      if(fs.realpathSync(artifact)!==artifact||!artifact.startsWith(fs.realpathSync(installationRoot)+path.sep))throw new Error('语义运行时材料路径不安全');
      const digest=sha256(fs.readFileSync(artifact));
      for(const source of sources)if(source.sha256===digest)runtimeSources.push({...source,artifact:name,reason:'exact-current-foundation-runtime; remains a verified runtime dependency'});
    }
  }
  const digest=sha256(canonicalStringify({sources,runtimeSources}));
  if(inventories.get(project)?.sourceDigest===digest)return structuredClone(inventories.get(project));
  const {ts}=createRequire(import.meta.url)('ts-morph');
  for(const source of sources) {
    const text=fs.readFileSync(resolveProjectFile(project,source.path),'utf8');
    semanticSources.push({path:source.path,sha256:source.sha256,semanticSha256:sourceSemanticDigest(source.path,Buffer.from(text))});
    if(runtimeSources.some(input=>input.path===source.path))continue;
    if(!/\.(html|[cm]?[jt]sx?)$/u.test(source.path))continue;
    const obligation=(kind,start,excerpt)=>obligations.push({key:`${source.path}:${start}:${kind}`,kind,file:source.path,sha256:source.sha256,line:text.slice(0,start).split('\n').length,offset:start,excerpt});
    const scriptInventory=(input,offset=0)=>{
      const file=ts.createSourceFile(source.path,input,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      const visit=node=>{
        if(ts.isFunctionDeclaration(node)&&node.name&&node.body)programs.push({kind:'handler',name:node.name.text,file:source.path,start:offset+node.getStart(file),end:offset+node.end,body:node.body.getText(file)});
        if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&/^(?:React\.)?useState$/u.test(node.initializer.expression.getText(file)))programs.push({kind:'state',file:source.path,name:node.name.elements[0]?.name?.getText(file),setter:node.name.elements[1]?.name?.getText(file),start:offset+node.getStart(file),end:offset+node.end});
        let kind=null;
        if(ts.isIfStatement(node)||ts.isConditionalExpression(node)||ts.isCaseClause(node)||ts.isCatchClause(node))kind='state-branch';
        if(ts.isCallExpression(node)&&/\b(addEventListener|useState|useReducer|dispatch|set[A-Z][A-Za-z0-9_]*)\s*\(/u.test(node.expression.getText(file)+'('))kind='state-effect';
        if(kind)obligation(kind,offset+node.getStart(file),node.getText(file).slice(0,500));
        ts.forEachChild(node,visit);
      };visit(file);
    };
    const add=(tag,start,attributes,parent=null)=>{
      for(const [name,value]of Object.entries(attributes))if(/^on[A-Z]|^on[a-z]|^aria-controls$/u.test(name))obligation('interaction-binding',start,`${name}=${value}`);
      const get=name=>attributes[name] || null;
      objects.push({key:`${source.path}:${start}`,file:source.path,sha256:source.sha256,line:text.slice(0,start).split('\n').length,offset:start,tag,parent,persistentId:get('data-foundation-object-id'),name:get('data-foundation-label') || get('aria-label') || null,role:get('role') || tag,ownerId:get('data-foundation-owner-id') || objects.find(object=>object.key===parent)?.ownerId || null,attributes,ownText:source.path.endsWith('.html')?text.slice(start+text.slice(start).indexOf('>')+1).split('<')[0].trim():null,htmlId:get('id'),incarnation:get('data-foundation-incarnation'),instanceKey:get('data-foundation-instance-id'),componentId:get('data-foundation-component-id'),bindings:Object.entries(attributes).filter(([key])=>/^on[A-Z]|^on[a-z]|^aria-controls$|^data-foundation-(?:target|state|field)/u.test(key)).map(([kind,target])=>({kind,target})),source:'implementation-structure',semanticState:'not-reviewed'});
    };
    if(source.path.endsWith('.html')) {
      // Bounded lexical coverage only. HTML error recovery, templates and script
      // generated nodes require a rendered observation; never call this complete.
      const input=text.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,m=>' '.repeat(m.length));
      for(const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))scriptInventory(match[1],match.index+match[0].indexOf('>')+1);
      const stack=[];const tokens=/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
      for(const match of input.matchAll(tokens)) {
        const tag=match[1].toLowerCase();
        if(match[0].startsWith('</')){while(stack.length){if(stack.pop().tag===tag)break;}continue;}
        const attrs={};for(const a of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[a[1]]=a[2]??a[3]??a[4];
        if(!['html','head','meta','title','link','body','script','style'].includes(tag))add(tag,match.index,attrs,stack.at(-1)?.key || null);
        if(!/\/$/u.test(match[0].slice(0,-1))&&!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag))stack.push({tag,key:`${source.path}:${match.index}`});
      }
      limitations.push({file:source.path,reason:'HTML 为词法结构清单；动态节点与浏览器解析恢复未核验'});
    } else {
      scriptInventory(text);
      const file=ts.createSourceFile(source.path,text,ts.ScriptTarget.Latest,true,/x$/u.test(source.path)?ts.ScriptKind.TSX:ts.ScriptKind.JS);
      const visit=(node,parent=null)=>{
        if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)) {
          const opening=ts.isJsxElement(node)?node.openingElement:node;
          const attrs={};for(const attr of opening.attributes.properties)if(ts.isJsxAttribute(attr))attrs[attr.name.text]=attr.initializer?(ts.isStringLiteral(attr.initializer)?attr.initializer.text:attr.initializer.getText(file)):'true';
          add(opening.tagName.getText(file),node.getStart(file),attrs,parent);
          parent=`${source.path}:${node.getStart(file)}`;
        }
        ts.forEachChild(node,child=>visit(child,parent));
      };visit(file);
      if(file.parseDiagnostics.length)limitations.push({file:source.path,reason:'语法诊断；结构可能不完整'});
    }
  }
  const result={schemaVersion:'1.0.0',sourceDigest:digest,sources,runtimeSources,semanticSources,objects,obligations,programs,limitations,semanticState:'not-reviewed'};
  inventories.set(project,result);while(inventories.size>2)inventories.delete(inventories.keys().next().value);
  return structuredClone(result);
}

export function inspectStructureCoverage(facts,inventory) {
  const records=Object.values(facts).flatMap(doc=>doc?.items || []);
  const locations=records.flatMap(record=>(record.sourceStructure?.objects || []).map(object=>({...object,factId:record.id})));
  const covered=new Set(locations.filter(location=>inventory.sources.some(source=>source.path===location.file&&source.sha256===location.sha256)).map(location=>location.key));
  const missing=inventory.objects.filter(object=>!covered.has(object.key));
  const stale=locations.filter(location=>!inventory.objects.some(object=>object.key===location.key&&object.sha256===location.sha256));
  const pendingSemantics=records.filter(record=>record.sourceStructure && record.sourceStructure.semanticState!=='reviewed');
  return {state:missing.length||stale.length?'pending':'structurally-recorded',sourceDigest:inventory.sourceDigest,missing,stale,pendingSemantics:pendingSemantics.map(x=>x.id),limitations:inventory.limitations,semanticState:'requires-current-semantic-evidence',semanticCoverage:inspectSemanticCoverage(facts,inventory),mutationPerformed:false};
}

// Called only inside an already authorized exact batch. Keep existing product
// semantics and IDs; attach observed structure to its existing source owner.
export function attachObservedStructure(payload,inventory,facts={}) {
  const result=structuredClone(payload);
  for(const document of result.documents || [])for(const record of document.upserts || []) {
    if(!['pages','components'].includes(document.kind))continue;
    const declared=new Map((result.sources || []).map(input=>[input.path,input.sha256]));
    const bound=new Set([record.implementationMapping,...(record.previewBinding?.inputs || []).map(input=>input.path),...(record.assetModel?.implementationInputs || []).map(input=>input.to)]);
    // Dependencies belong here only with an explicit owner and exact batch bytes.
    // Merely importing a file never transfers its objects to every consumer.
    const objects=inventory.objects.filter(object=>object.file===record.implementationMapping || object.ownerId===record.id&&bound.has(object.file)&&declared.get(object.file)===object.sha256);
    const source=inventory.sources.find(source=>source.path===record.implementationMapping);
    if(!source)continue;
    if(!result.sources?.some(input=>input.path===source.path && input.sha256===source.sha256))continue;
    const previous=facts[document.kind]?.items?.find(item=>item.id===record.id)?.sourceStructure?.identityHistory || [];
    const identityHistory=reconcileObjectHistory(previous,objects);
    const supplied=record.sourceStructure?.semantics || facts[document.kind]?.items?.find(item=>item.id===record.id)?.sourceStructure?.semantics;
    const semantics=!supplied || supplied.producer==='foundation-source-semantics/1'?deriveSourceSemantics(inventory,source.path):supplied;
    record.sourceStructure={semantics,identityHistory,semanticInputs:inventory.semanticSources.filter(input=>input.path===source.path || (record.assetModel?.implementationInputs?.some(edge=>edge.to===input.path)||record.previewBinding?.inputs?.some(edge=>edge.path===input.path))),schemaVersion:'1.0.0',inputs:inventory.sources.filter(input=>(input.path===source.path || (record.assetModel?.implementationInputs?.some(edge=>edge.to===input.path)||record.previewBinding?.inputs?.some(edge=>edge.path===input.path)))&&result.sources.some(declared=>declared.path===input.path&&declared.sha256===input.sha256)),semanticState:'not-reviewed',objects,relations:objects.filter(object=>object.parent).map(object=>({type:'contains',from:object.parent,to:object.key,identityScope:'source-bytes'})),limitations:inventory.limitations.filter(item=>item.file===source.path)};
  }
  return result;
}

// Codex supplies business meaning; the independent implementation inventory
// supplies obligations. Source locations and typed edges are checked separately
// from human semantic judgments. No static inference is promoted to verification.
export function inspectSemanticCoverage(facts,inventory) {
  const records=Object.values(facts).flatMap(doc=>doc?.items || []);
  const nodes=[],relations=[],invalid=[];
  for(const record of records) {
    const graph=record.sourceStructure?.semantics;
    if(!graph)continue;
    for(const limitation of graph.unsupported || [])invalid.push({ownerId:record.id,...limitation});
    const local=graph.nodes || [],ids=new Set(local.map(node=>node.id));
    for(const node of local) {
      if(!node.id||!['region','component','instance','field','state','interaction','data','token'].includes(node.kind)||!node.name?.trim()||!node.sourceKeys?.length)invalid.push({ownerId:record.id,id:node.id,reason:'语义对象缺身份、类型、名称或来源'});
      nodes.push({...node,ownerId:record.id});
    }
    for(const relation of graph.relations || []) {
      if(!relation.id||!['contains','uses','triggers','data-affects','transitions','styles'].includes(relation.type)||!ids.has(relation.from)||!ids.has(relation.to)||!relation.sourceKeys?.length)invalid.push({ownerId:record.id,id:relation.id,reason:'语义关系类型、端点或来源无效'});
      relations.push({...relation,ownerId:record.id});
    }
    if(ids.size!==local.length)invalid.push({ownerId:record.id,reason:'语义身份重复'});
  }
  const sources=new Map([...(inventory.objects || []),...(inventory.obligations || [])].map(item=>[item.key,item]));
  for(const item of [...nodes,...relations])for(const key of item.sourceKeys || []) {
    const source=sources.get(key);
    if(!source||!item.sources?.some(input=>input.path===source.file&&input.sha256===source.sha256))invalid.push({ownerId:item.ownerId,id:item.id,key,reason:'语义来源缺失或字节已变化'});
  }
  const missing=(inventory.obligations || []).filter(obligation=>!nodes.some(node=>node.sourceKeys?.includes(obligation.key))||!relations.some(relation=>['data-affects','transitions'].includes(relation.type)&&relation.sourceKeys?.includes(obligation.key)));
  return {state:missing.length||invalid.length?'pending':'recorded-not-reviewed',missing,invalid,nodes,relations,sourceDigest:inventory.sourceDigest};
}

// Read-only projection of the existing facts, shared by panel and inspector.
export function projectObjectRelations(facts) {
  return Object.values(facts).flatMap(doc=>(doc?.items || []).flatMap(record=>{
    const graph=record.sourceStructure?.semantics;if(!graph)return [];
    const nodes=new Map((graph.nodes || []).map(node=>[node.id,node]));
    return (graph.relations || []).map(relation=>({...relation,id:`${record.id}:${relation.id}`,ownerId:record.id,fromName:nodes.get(relation.from)?.name || relation.from,toName:nodes.get(relation.to)?.name || relation.to,fromBindings:nodes.get(relation.from)?.objectIds || [],toBindings:nodes.get(relation.to)?.objectIds || [],semanticState:'recorded-not-reviewed',updatedAt:record.updatedAt}));
  }));
}
