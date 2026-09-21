import fs from 'node:fs';import path from 'node:path';
import {resolveProjectFile,normalizePreviewPath} from './path-boundary.mjs';
import {sha256} from './install-contract.mjs';
export function planStaticPreview({project,file,id,config}) {
  if([...(config.routes || []),...(config.assets || [])].some(entry=>entry.path.startsWith('/__foundation/standard-preview/')))throw new Error('用户路由与标准桥接保留路径冲突');
  const existing=(config.routes || []).filter(route=>route.file===file);
  if(existing.length>1)throw new Error('同一 HTML 存在多个用户路由，需明确选择');
  const route=existing[0]?.path || normalizePreviewPath('/preview/'+id+'/'+file);
  const reserved=new Map([...(config.routes || []),...(config.assets || [])].map(entry=>[entry.path,entry.file]));
  const entries=new Map(),inputs=new Map(),visited=new Set();
  const visit=(source,url)=>{
    normalizePreviewPath(url);if(reserved.has(url)&&reserved.get(url)!==source)throw new Error('自动路由与用户配置冲突：'+url);
    if(entries.has(url)&&entries.get(url)!==source)throw new Error('资源路由冲突');entries.set(url,source);
    const bytes=fs.readFileSync(resolveProjectFile(project,source));inputs.set(source,{path:source,sha256:sha256(bytes)});
    const visitKey=source+'@'+url;if(visited.has(visitKey))return;visited.add(visitKey);if(visited.size>512)throw new Error('静态资源闭包超出支持范围');
    const text=bytes.toString('utf8'),refs=[];
    if(source.endsWith('.html')){
      if(/\bsrcset\s*=/iu.test(text))throw new Error('响应图片资源需显式预览配置');
      if(/<base\b/iu.test(text))throw new Error('HTML base 路径需显式配置');
      for(const tag of text.matchAll(/<(?:script|link|img|source|video|audio)\b[^>]*>/giu))for(const attr of tag[0].matchAll(/(?:src|href|poster)\s*=\s*["']([^"']+)["']/giu))refs.push(attr[1]);
    }
    if(/\.(?:css|html)$/u.test(source))for(const ref of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/giu))refs.push(ref[1]);
    if(source.endsWith('.css'))for(const ref of text.matchAll(/@import\s*["']([^"']+)["']/giu))refs.push(ref[1]);
    if(/\.(?:[cm]?js|html)$/u.test(source)&&/\bimport\s*\(\s*[^"'\s]/u.test(text))throw new Error('动态资源需显式预览配置');
    if(/\.(?:[cm]?js|html)$/u.test(source))for(const ref of text.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/gu))refs.push(ref[1]);
    for(const reference of refs){
      if(reference.startsWith('#')||reference.startsWith('data:'))continue;
      if(/^(?:[a-z]+:|\/\/)/iu.test(reference))throw new Error('外部资源需显式预览配置');
      const parsed=new URL(reference,'http://foundation.local'+url),clean=decodeURIComponent(reference.split(/[?#]/u)[0]);
      const target=path.posix.normalize(clean.startsWith('/')?clean.slice(1):path.posix.join(path.posix.dirname(source),clean));
      visit(target,parsed.pathname);
    }
  };visit(file,route);
  return {route,inputs:[...inputs.values()].sort((a,b)=>a.path.localeCompare(b.path)),routes:[{path:route,file}],assets:[...entries].filter(([url])=>url!==route).map(([path,file])=>({path,file}))};
}
