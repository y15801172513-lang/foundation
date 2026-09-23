import fs from 'node:fs';
import {createRequire} from 'node:module';
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256} from './install-contract.mjs';
const postcss=createRequire(import.meta.url)('postcss');
export function prepareMotionScene({project,asset}) {
 if(!/^[\w-]+$/u.test(asset.id || ''))throw new Error('动效身份格式不安全');
 const file=asset.implementationMapping;if(!file?.endsWith('.css')||!/^[\w-]+$/u.test(asset.animationName || ''))throw new Error('动效隔离需要明确 CSS keyframes 定义');
 const bytes=fs.readFileSync(resolveProjectFile(project,file,'动效定义')),source=postcss.parse(bytes.toString(),{from:file}),output=postcss.root(),uses=[];
 const append=(node,original)=>{let copy=node;for(let parent=original.parent;parent?.type==='atrule';parent=parent.parent){const wrapper=parent.clone({nodes:[]});wrapper.append(copy);copy=wrapper;}output.append(copy);};
 source.walkAtRules('keyframes',node=>{if(node.params===asset.animationName)append(node.clone(),node);});
 source.walkRules(rule=>{
  if(rule.parent?.type==='atrule'&&rule.parent.name==='keyframes')return;
  const animation=rule.nodes.filter(node=>node.type==='decl'&&/^animation(?:-|$)/u.test(node.prop));
  if(animation.some(node=>new RegExp('(?:^|[ ,])'+asset.animationName+'(?:$|[ ,])').test(node.value))){
    for(const selector of rule.selector.split(',').map(value=>value.trim())) {
    const index=uses.length;uses.push({selector});append(postcss.rule({selector:'.foundation-motion-sample-'+index,nodes:animation.map(node=>node.clone())}),rule);
    source.walkRules(other=>{if(other!==rule&&selector===other.selector.trim()){const overrides=other.nodes.filter(node=>node.type==='decl'&&/^animation-/u.test(node.prop));if(overrides.length)append(postcss.rule({selector:'.foundation-motion-sample-'+index,nodes:overrides.map(node=>node.clone())}),other);}});
    }
  }
 });
 const required=new Set();
 const collect=value=>{for(const match of value.matchAll(/var\(\s*(--[\w-]+)/gu))required.add(match[1]);};
 output.walkDecls(decl=>collect(decl.value));
 let size=-1;while(size!==required.size){size=required.size;source.walkDecls(decl=>{if(required.has(decl.prop))collect(decl.value);});}
 source.walkRules(rule=>{const variables=rule.nodes.filter(node=>node.type==='decl'&&required.has(node.prop));if(!variables.length)return;if(!/^(?::root|html)(?:$|[.[:])/u.test(rule.selector))throw new Error('动效变量需要明确根作用域，不能猜局部继承');append(rule.clone({nodes:variables.map(node=>node.clone())}),rule);});
 if(!uses.length||!output.nodes.some(node=>node.toString().includes('@keyframes')))throw new Error('动效缺少可核验的实际触发规则');
 const css=output.toString();if(/url\s*\(|@import|<\/style/iu.test(css))throw new Error('动效样例含未封闭外部资源');
 const digest=sha256(css+JSON.stringify(uses)+asset.id),prefix='/__foundation/declarations/motion-'+digest.slice(0,24)+'/',route=prefix+'index.html';
 const renderDigest=sha256(css+JSON.stringify(uses)+asset.id);
 const samples=uses.map((use,index)=>'<div class="foundation-motion-sample foundation-motion-sample-'+index+'">内容入场示例</div>').join('');
 const html='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:16px sans-serif}.foundation-motion-sample{margin:16px;padding:24px;background:#eee;border-radius:12px}'+css+'</style></head><body><script type="module">import {mountAssetScene} from "./bridge.mjs";await mountAssetScene({definitionId:'+JSON.stringify(asset.id)+',scenarioId:"motion",render(root){root.setAttribute("data-foundation-source-scene",'+JSON.stringify(renderDigest)+');root.innerHTML='+JSON.stringify(samples)+';}});</script></body></html>';
 return {route,prefix,digest,renderDigest,plan:{inputs:[{path:file,sha256:sha256(bytes)}],uses},resources:{[route]:{bytes:Buffer.from(html),mime:'text/html;charset=utf-8'}}};
}
