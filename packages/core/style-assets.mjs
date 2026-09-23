import fs from 'node:fs';
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256} from './install-contract.mjs';
// Bounded source observations, never a claim of computed style or playback.
export function discoverStyleAssets(project,sources,facts,updatedAt) {
  const records=[];
  for(const source of sources.filter(source=>source.path.endsWith('.css')&&!/^(?:dist|build|node_modules|\.tmp)\//u.test(source.path))) {
    const text=fs.readFileSync(resolveProjectFile(project,source.path),'utf8');
    const pages=facts.pages.items.filter(page=>page.implementationMapping===source.path||page.previewBinding?.inputs?.some(input=>input.path===source.path)||page.sourceStructure?.inputs?.some(input=>input.path===source.path)).map(page=>page.id);
    const declarations=new Map();
    for(const match of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)[;}]/gu))declarations.set(match[1],[...new Set([...(declarations.get(match[1]) || []),match[2].trim()])]);
    for(const [name,values] of declarations) {
      const used=new RegExp('var\\(\\s*'+name+'\\s*[,)]').test(text);
      if(!used)continue;
      const id='token_'+sha256(source.path+':'+name).slice(0,20);
      if(facts['design-tokens'].items.some(item=>item.id!==id&&(item.cssVariable===name||item.name===name)))continue;
      const old=facts['design-tokens'].items.find(item=>item.id===id);
      if(old?.implementationSha256===source.sha256)continue;
      const value=values.length===1?values[0]:null;
      const tokenType=old?.tokenType || (/color|background|foreground|primary|border|muted|accent|ring/u.test(name)||values.every(value=>/^(?:#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|oklab|lab|lch|color)\()/iu.test(value))?'color':/font.*family|font.*sans/u.test(name)?'font-family':/line-height/u.test(name)?'line-height':/font.*size/u.test(name)?'font-size':/radius/u.test(name)?'radius':/duration/u.test(name)?'duration':'spacing');
      records.push({kind:'design-tokens',record:{...old,id,name:old?.name || name,cssVariable:name,tokenType,value: value || values[0],modeValues:values,implementationMapping:source.path,status:'draft',source:'source-analysis',verificationStatus:'unverified',pageIds:pages,updatedAt,synchronization:{state:'source-derived',reason:values.length>1?'多个主题值，运行计算值待核':'发现声明及直接 var 引用，运行计算值待核'}}});
    }
    for(const match of text.matchAll(/@keyframes\s+([\w-]+)/gu)) {
      const name=match[1],id='motion_'+sha256(source.path+':'+name).slice(0,20);
      if(facts.motions.items.some(item=>item.id!==id&&(item.animationName===name||item.name===name)))continue;
      const old=facts.motions.items.find(item=>item.id===id);if(old?.implementationSha256===source.sha256)continue;
      records.push({kind:'motions',record:{...old,id,name:old?.name || name,animationName:name,implementationMapping:source.path,status:'draft',source:'source-analysis',verificationStatus:'unverified',pageIds:pages,updatedAt,synchronization:{state:'source-derived',reason:'发现实际 keyframes；触发、使用和减少动态效果运行待核'}}});
    }
  }
  return records;
}
