import fs from 'node:fs';
import {createRequire} from 'node:module';
const postcss=createRequire(import.meta.url)('postcss');
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';

// Syntax evidence carries source, selector and conditional scope. It never
// claims that the cascade applied, or that a motion actually played.
export function inspectStyleSources(project,sources) {
  const declarations=[],uses=[],keyframes=[],limitations=[];
  for(const source of sources.filter(source=>/\.(?:css|html|vue|svelte)$/u.test(source.path)&&! /^(?:dist|build|node_modules|\.tmp)\//u.test(source.path))) {
    const text=fs.readFileSync(resolveProjectFile(project,source.path),'utf8');
    const blocks=source.path.endsWith('.css')?[{text,line:0}]:[...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)].map(match=>({text:match[1],line:text.slice(0,match.index+match[0].indexOf('>')+1).split('\n').length-1}));
    for(const block of blocks) {
      let ast;try{ast=postcss.parse(block.text,{from:source.path});}catch(error){limitations.push({path:source.path,reason:'CSS 语法无法解析',line:error.line});continue;}
      const location=node=>{const conditions=[];let selector=null;for(let parent=node.parent;parent;parent=parent.parent){if(parent.type==='rule'&&!selector)selector=parent.selector;if(parent.type==='atrule')conditions.unshift({name:parent.name,params:parent.params});}return {path:source.path,sha256:source.sha256,line:(node.source?.start?.line || 1)+block.line,selector,conditions};};
      ast.walkDecls(node=>{
        const origin=location(node);
        if(node.prop.startsWith('--'))declarations.push({...origin,name:node.prop,value:node.value});
        for(const match of node.value.matchAll(/var\(\s*(--[\w-]+)/gu))uses.push({...origin,name:match[1],property:node.prop,value:node.value});
        if(/^(?:-webkit-)?animation(?:-name)?$/u.test(node.prop))uses.push({...origin,animation:true,property:node.prop,value:node.value});
      });
      ast.walkAtRules(/^(?:-webkit-)?keyframes$/u,node=>keyframes.push({...location(node),name:node.params,frames:node.nodes.filter(n=>n.type==='rule').map(n=>({at:n.selector,styles:Object.fromEntries((n.nodes || []).filter(n=>n.type==='decl').map(n=>[n.prop,n.value]))}))}));
    }
  }
  return {declarations,uses,keyframes,limitations};
}

export function discoverStyleAssets(project,sources,facts,updatedAt) {
  const observation=inspectStyleSources(project,sources),records=[];
  const groups=new Map();
  for(const definition of observation.declarations){const key=definition.path+':'+definition.name;groups.set(key,[...(groups.get(key)||[]),definition]);}
  const pagesFor=paths=>facts.pages.items.filter(page=>paths.includes(page.implementationMapping)||[...(page.previewBinding?.inputs || []),...(page.sourceStructure?.inputs || [])].some(input=>paths.includes(input.path))).map(page=>page.id);
  const common=(old,id,name,definitions,usage)=>{
    const paths=[...new Set([...definitions,...usage].map(item=>item.path))];
    const inputs=sources.filter(source=>paths.includes(source.path));
    return {...old,id,name:old?.name || name,implementationMapping:definitions[0].path,status:'draft',source:'source-analysis',verificationStatus:'unverified',pageIds:pagesFor(paths),updatedAt,styleEvidence:{definitions,uses:usage,limitations:observation.limitations},previewBinding:{producer:'foundation-style-source/1',inputs},synchronization:{state:'source-derived',reason:'已提取定义、使用位置和条件；继续实际页面核验'}};
  };
  for(const definitions of groups.values()) {
    const {path,name}=definitions[0],id='token_'+sha256(path+':'+name).slice(0,20);
    const old=facts['design-tokens'].items.find(item=>item.id===id);
    if(facts['design-tokens'].items.some(item=>item.id!==id&&(item.cssVariable===name||item.name===name)))continue;
    const usage=observation.uses.filter(use=>use.name===name),values=[...new Set(definitions.map(item=>item.value))];
    const properties=new Set(usage.map(use=>use.property));
    const inferredType=properties.has('font-size')?'font-size':properties.has('font-family')?'font-family':properties.has('line-height')?'line-height':properties.has('border-radius')?'radius':properties.has('animation-duration')||properties.has('transition-duration')?'duration':(/color|background|foreground|primary|border|muted|accent|ring/u.test(name)||values.every(value=>/^(?:#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|oklab|lab|lch|color)\()/iu.test(value))?'color':/font.*family|font.*sans/u.test(name)?'font-family':/line-height/u.test(name)?'line-height':/font.*size/u.test(name)?'font-size':/radius/u.test(name)?'radius':/duration/u.test(name)?'duration':'spacing');
    const tokenType=old?.source!=='source-analysis'&&old?.tokenType?old.tokenType:inferredType;
    const record={...common(old,id,name,definitions,usage),cssVariable:name,tokenType,value:values[0],modeValues:values,description:old?.description || `CSS 变量 ${name}；${usage.length?`用于 ${[...new Set(usage.map(use=>use.property))].join('、')}`:'当前源码闭包内没有直接使用'}。通过 var(${name}) 引用；作用范围以定义选择器及条件为准。`};
    if(!old||old.tokenType!==record.tokenType||old.implementationSha256!==sources.find(source=>source.path===record.implementationMapping)?.sha256||canonicalStringify(old.styleEvidence)!==canonicalStringify(record.styleEvidence)||canonicalStringify(old.pageIds)!==canonicalStringify(record.pageIds))records.push({kind:'design-tokens',record});
  }
  for(const definition of observation.keyframes) {
    const name=definition.name,id='motion_'+sha256(definition.path+':'+name).slice(0,20);
    if(facts.motions.items.some(item=>item.id!==id&&(item.animationName===name||item.name===name)))continue;
    const old=facts.motions.items.find(item=>item.id===id),directUses=observation.uses.filter(use=>use.animation&&use.value.split(/[\s,]+/u).includes(name));
    const usage=observation.uses.filter(use=>use.animation&&(directUses.includes(use)||directUses.some(direct=>direct.path===use.path&&direct.selector===use.selector)));
    const base=common(old,id,name,[definition],usage),previewRoute=facts.pages.items.find(page=>base.pageIds.includes(page.id)&&page.preview)?.preview || null;
    const record={...base,animationName:name,previewRoute,description:old?.description || `关键帧 ${name}，改变 ${[...new Set(definition.frames.flatMap(frame=>Object.keys(frame.styles)))].join('、')}；${directUses.length} 处声明使用。响应式和减少动态效果规则见使用条件。`};
    if(!old||old.previewRoute!==previewRoute||old.implementationSha256!==sources.find(source=>source.path===record.implementationMapping)?.sha256||canonicalStringify(old.styleEvidence)!==canonicalStringify(record.styleEvidence)||canonicalStringify(old.pageIds)!==canonicalStringify(record.pageIds))records.push({kind:'motions',record});
  }
  return records;
}
