// Shared, browser-safe identity vocabulary. Display text never supplies identity.
const clean = value => typeof value === 'string' ? value.trim() : '';
export function inspectObjectName(value) {
  const name=clean(value);
  return {state:!name?'missing':!/[\p{L}\p{N}]/u.test(name)?'symbol-only':name.length>120?'too-long':'usable',name};
}
export function objectLocator(object={}) {
  const persistentId=clean(object.persistentId || object.identity?.persistentId);
  const generation=object.identityGeneration || object.identity?.generation || null;
  return {schemaVersion:'foundation-object/1',pageId:object.pageId || null,contentVersion:object.contentVersion || null,projectId:object.projectId || null,kind:persistentId?'persistent':'temporary',persistentId:persistentId || null,generation,instanceKey:object.instanceId || null,handle:object.inspectorId || null,session:object.session || object.identity?.session || null,revision:object.revision || object.identity?.revision || null,source:object.sourceLocation || null,scope:persistentId&&generation?'project identity with generation; re-resolve on revision change':'current document/session only; cannot resolve after reload'};
}
export function resolveObjectLocator(locator,objects,{projectId,revision,session}={}) {
  if(locator.projectId!==projectId)return {state:'invalid',reason:'project-mismatch'};
  if(locator.kind!=='persistent'&&(locator.revision!==revision||locator.session!==session))return {state:'invalid',reason:'temporary-locator-expired'};
  if(locator.kind==='persistent'&&!locator.generation&&(locator.revision!==revision||locator.session!==session||!locator.handle))return {state:'invalid',reason:'persistent-generation-unverified'};
  const matches=objects.filter(object=>locator.kind==='persistent'?object.persistentId===locator.persistentId&&(object.instanceId || null)===(locator.instanceKey || null):object.inspectorId===locator.handle);
  if(matches.length===1&&locator.kind==='persistent'&&!locator.generation&&matches[0].inspectorId!==locator.handle)return {state:'invalid',reason:'untracked-source-key-replaced'};
  if(matches.length===1&&locator.kind==='persistent'&&locator.generation&&locator.generation!==(matches[0].identityGeneration || matches[0].identity?.generation))return {state:'invalid',reason:'object-generation-changed'};
  return matches.length===1?{state:'resolved',object:matches[0]}:{state:matches.length?'ambiguous':'invalid',reason:matches.length?'duplicate-identity':'object-removed'};
}

// Stored inside the owning sourceStructure fact and committed by the same batch.
// Missing observations produce tombstones; a reused key always gets a new birth.
// Duplicate source keys are not eligible for persistent resolution.
export function reconcileObjectHistory(previous=[],objects=[]) {
  const key=object=>JSON.stringify([object.persistentId,object.instanceKey || null]);
  const groups=new Map();
  for(const object of objects)if(object.persistentId){const id=key(object);groups.set(id,[...(groups.get(id)||[]),object]);}
  const old=new Map(previous.map(object=>[key(object),object]));
  const result=[];
  for(const id of new Set([...old.keys(),...groups.keys()])) {
    const prior=old.get(id),current=groups.get(id);
    const state=!current?'removed':current.length===1?'active':'ambiguous';
    const identity=current?.[0] || prior;
    result.push({persistentId:identity.persistentId,instanceKey:identity.instanceKey || null,generation:state==='active'&&prior?.state!=='active'?globalThis.crypto.randomUUID():prior?.generation || globalThis.crypto.randomUUID(),state});
  }
  return result.sort((a,b)=>key(a).localeCompare(key(b)));
}

// Birth and migration events belong to the existing project facts transaction.
// A retain/move intent must precede edits; an unobserved external edit cannot
// retroactively establish continuity from equal display keys.
export function beginObjectLifetimes(previous=[],actions=[]) {
  const records=structuredClone(previous);
  for(const action of actions) {
    if(!['create','retain','move','retire'].includes(action.kind))throw new Error('对象生命周期操作无效');
    if(action.kind==='create') {
      if(!action.objectId||!action.sourceFile||!action.ownerId)throw new Error('创建对象需要 objectId、ownerId 和 sourceFile');
      if(records.some(item=>item.objectId===action.objectId&&(item.instanceKey || null)===(action.instanceKey || null)&&['active','reserved'].includes(item.state)))throw new Error('对象身份仍在使用，不能重复创建');
      records.push({objectId:action.objectId,instanceKey:action.instanceKey || null,ownerId:action.ownerId,sourceFile:action.sourceFile,incarnation:globalThis.crypto.randomUUID(),state:'reserved',intent:'create'});
    } else {
      const record=records.find(item=>item.incarnation===action.incarnation);
      if(!record||(action.kind==='retire'?record.state==='removed':record.state!=='active'))throw new Error('只能操作明确存在且未删除的出生身份');
      record.intent=action.kind;
      if(action.kind==='move'){if(!action.ownerId||!action.sourceFile)throw new Error('移动需要精确目标 owner 与源码');record.migration={fromOwner:record.ownerId,fromFile:record.sourceFile,toOwner:action.ownerId,toFile:action.sourceFile};record.ownerId=action.ownerId;record.sourceFile=action.sourceFile;}
    }
  }
  return records;
}
export function finishObjectLifetimes(records,objects,files) {
  return records.map(input=>{
    const record={...input};
    const matches=objects.filter(object=>object.incarnation===record.incarnation);
    if(record.state==='removed'){record.reason=matches.length?'retired-birth-still-in-source':'explicit-retirement';return record;}
    const file=files.find(file=>file.path===record.sourceFile);
    if(record.intent==='retire'){record.state='removed';record.reason=matches.length?'retired-birth-still-in-source':'explicit-retirement';delete record.intent;return record;}
    const exact=matches.length===1&&matches[0].file===record.sourceFile&&matches[0].ownerId===record.ownerId&&matches[0].persistentId===record.objectId&&(matches[0].instanceKey || null)===record.instanceKey;
    if(!exact||!file){record.state='unverified';record.reason='source-binding-missing';}
    else if(record.intent){record.state='active';record.sourcePhysical=file.physical;record.sourceSha256=file.sha256;delete record.reason;}
    else if(record.sourcePhysical!==file.physical){record.state='unverified';record.reason='external-change-without-continuity-intent';}
    delete record.intent;return record;
  });
}

// Names describe purpose; text samples and identity are separate contracts.
export function shortObjectName({label='',accessible='',role='div',decorative=false,instanceKey=null,peerInstanceKeys=[],objectKey=null,peerObjectKeys=[],text=''}={}) {
  const segments=value=>Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(String(value)),item=>item.segment);
  const limit=(value,count)=>segments(value).slice(0,count).join('');
  const roles={div:'布局容器',span:'行内文本',p:'正文文本',h1:'主标题',h2:'区块标题',h3:'小标题',header:'页头区域',main:'主体区域',footer:'页尾区域',section:'内容区域',article:'内容条目',button:'操作按钮',link:'导航链接',a:'导航链接',input:'输入字段',textbox:'文本输入',textarea:'文本输入',select:'选项选择',navigation:'导航区域',nav:'导航区域',form:'表单区域',ul:'列表',ol:'有序列表',li:'列表条目',img:'图片',svg:'图形',path:'图形路径'};
  const declared=clean(label)||clean(accessible);
  const fallback=decorative?'装饰容器':roles[role] || '结构对象';
  const usable=/[\p{L}\p{N}]/u.test(declared);
  const baseName=usable?limit(declared,20):fallback;
  const keys=[...new Set([...peerInstanceKeys,instanceKey].filter(Boolean).map(String))].sort();
  const objects=[...new Set(peerObjectKeys.filter(Boolean))].sort();
  const part=objectKey&&objects.length>1?String(objects.indexOf(objectKey)+1):null;
  const suffix=[instanceKey?String(keys.indexOf(String(instanceKey))+1):null,part].filter(Boolean).join('.');
  const qualifier=suffix?' · '+suffix:'';
  const name=limit(baseName,Math.max(0,28-segments(qualifier).length))+qualifier;
  return {name,state:usable?'declared':'inferred',source:usable?(clean(label)?'source-annotation':'accessible-name'):'structural',summary:limit(clean(text),80),instanceKey};
}

// A rendered leaf is a distinct semantic part of a source-bound icon call.
export function renderedIconPart(element) {
  const root=element.parentElement;
  if(root?.localName!=='svg'||!root.hasAttribute('data-foundation-render-map'))return null;
  let mappings;try{mappings=JSON.parse(root.getAttribute('data-foundation-render-map'));}catch{return null;}
  if(!Array.isArray(mappings))return null;
  const matches=[];
  for(const mapping of mappings)for(const [tag,attrs] of mapping.nodes || []) {
    const exact=node=>node.localName===tag&&Object.entries(attrs).filter(([key])=>key!=='key').every(([key,value])=>node.getAttribute(key)===String(value));
    if(exact(element)&&[...root.children].filter(exact).length===1)matches.push({root,mapping,key:attrs.key,tag,attrs});
  }
  return matches.length===1?matches[0]:null;
}
