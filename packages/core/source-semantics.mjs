import {sha256} from './install-contract.mjs';
const id=(kind,key)=>`${kind}_${sha256(key).slice(0,20)}`;
// Limited source expressions, not a natural-language business-meaning oracle.
export function deriveSourceSemantics(inventory,file) {
  const objects=inventory.objects.filter(object=>object.file===file),obligations=inventory.obligations.filter(item=>item.file===file),programs=(inventory.programs || []).filter(item=>item.file===file),sources=inventory.sources.filter(source=>source.path===file);
  const nodes=[],relations=[],unsupported=[],byKey=new Map();
  const node=(key,kind,name,sourceKeys,extra={})=>{const value={id:id(kind,key),kind,name:name || `${kind}（名称待核）`,sourceKeys,sources,nameSource:'source-expression',confidence:'source-derived-not-reviewed',...extra};nodes.push(value);return value;};
  const edge=(type,from,to,sourceKeys,extra={})=>relations.push({id:id(type,`${from.id}:${to.id}:${sourceKeys.join(',')}`),type,from:from.id,to:to.id,sourceKeys,sources,...extra});
  for(const object of objects){const attrs=object.attributes || {},kind=['input','textarea','select'].includes(object.tag)?'field':object.componentId?'instance':/^[A-Z]/u.test(object.tag)?'component':'region';const name=object.name || attrs.name || object.ownText || (attrs['aria-hidden']==='true'?'装饰对象（用途待命名）':object.tag);byKey.set(object.key,node(object.key,kind,name,[object.key],{objectIds:[object.persistentId,object.htmlId].filter(Boolean),sourceObjectKey:object.key}));}
  for(const object of objects)if(byKey.has(object.parent))edge('contains',byKey.get(object.parent),byKey.get(object.key),[object.key]);
  const stateNodes=new Map();
  for(const state of programs.filter(item=>item.kind==='state')){const obligation=obligations.find(item=>item.offset>=state.start&&item.offset<=state.end);if(obligation)stateNodes.set(state.setter,node(state.name,'state',state.name,[obligation.key]));}
  const eventHandlers=[];
  for(const obligation of obligations.filter(item=>item.kind==='interaction-binding')) {
    const object=objects.find(object=>object.offset===obligation.offset),owner=byKey.get(object?.key);if(!owner){unsupported.push({key:obligation.key,reason:'事件缺少唯一结构 owner'});continue;}
    const expression=obligation.excerpt.slice(obligation.excerpt.indexOf('=')+1).replace(/^\{|\}$/gu,'').trim();
    const matches=programs.filter(item=>item.kind==='handler'&&item.name===expression);
    const body=matches.length===1?matches[0].body:expression;
    const event=node(obligation.key,'interaction',object.name || object.ownText || obligation.excerpt.split('=')[0],[obligation.key],{objectIds:[object.persistentId,object.htmlId].filter(Boolean)});edge('triggers',owner,event,[obligation.key]);
    if(matches.length===1)eventHandlers.push({handler:matches[0],event});
    let supported=false;
    for(const [setter,state]of stateNodes)if(new RegExp(`\\b${setter}\\s*\\(`,'u').test(body)){edge('data-affects',event,state,[obligation.key]);supported=true;}
    const target=/\b(?:querySelector|closest)\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*(showModal|close)\s*\(/u.exec(body);
    if(target){const candidates=objects.filter(item=>target[2].startsWith('#')?item.htmlId===target[2].slice(1):item.tag===target[2]);if(candidates.length===1){const state=node(obligation.key+':'+target[3],'state',target[3]==='showModal'?'弹窗打开':'弹窗关闭',[obligation.key]);edge('transitions',event,state,[obligation.key]);edge('data-affects',state,byKey.get(candidates[0].key),[obligation.key]);supported=true;}}
    if(!supported)unsupported.push({key:obligation.key,reason:'事件表达式尚不在受支持的直接状态/弹窗调用范围'});
  }
  for(const obligation of obligations.filter(item=>item.kind!=='interaction-binding')) {
    const setters=[...stateNodes].filter(([setter])=>new RegExp(`\\b${setter}\\s*\\(`,'u').test(obligation.excerpt));
    if(/\buseState\s*\(/u.test(obligation.excerpt)){const state=programs.find(item=>item.kind==='state'&&obligation.offset>=item.start&&obligation.offset<=item.end),value=stateNodes.get(state?.setter);if(value){const initial=node(obligation.key+':initial','data','状态初始值',[obligation.key]);edge('data-affects',initial,value,[obligation.key]);continue;}}
    const handlers=eventHandlers.filter(({handler})=>obligation.offset>=handler.start&&obligation.offset<=handler.end);
    if(setters.length){const state=node(obligation.key,obligation.kind==='state-branch'?'state':'interaction',obligation.kind==='state-branch'?'条件分支':'状态更新',[obligation.key]);for(const [,target]of setters)edge('data-affects',state,target,[obligation.key]);for(const {event}of handlers)edge('triggers',event,state,[obligation.key]);}
    else {const reads=[...stateNodes.values()].filter(state=>new RegExp('\\b'+state.name+'\\b','u').test(obligation.excerpt));if(obligation.kind==='state-branch'&&reads.length){const branch=node(obligation.key,'state','条件渲染分支',[obligation.key]);for(const state of reads)edge('data-affects',state,branch,[obligation.key]);}else unsupported.push({key:obligation.key,reason:'无法证明该分支/调用与已识别状态的关系'});}
  }
  return {schemaVersion:'1.0.0',producer:'foundation-source-semantics/1',state:unsupported.length?'pending':'source-derived',nodes,relations,unsupported,limitations:['静态直接表达式覆盖，不证明用户需求意义或真实运行结果']};
}
