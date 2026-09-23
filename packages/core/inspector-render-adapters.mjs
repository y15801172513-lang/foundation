import fs from 'node:fs';
import {createRequire} from 'node:module';
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256} from './install-contract.mjs';
const {ts}=createRequire(import.meta.url)('ts-morph');
// Parse dependency literals without evaluating package code. Keys are authored
// by the renderer, never DOM indices. Unknown renderers remain unsupported.
export function lucideRenderMapping(project,name) {
  if(!/^[A-Z][A-Za-z0-9]*$/u.test(name))return null;
  const file='node_modules/lucide-react/dist/esm/icons/'+name.replace(/([a-z0-9])([A-Z])/gu,'$1-$2').toLowerCase()+'.js';
  let text;try{text=fs.readFileSync(resolveProjectFile(project,file,'图标定义'),'utf8');}catch{return null;}
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const literal=node=>{
    if(ts.isStringLiteral(node)||ts.isNumericLiteral(node))return node.text;
    if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);
    if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.map(p=>{if(!ts.isPropertyAssignment(p))throw new Error('图标定义不是静态属性');return [p.name.text,literal(p.initializer)];}));
    throw new Error('图标定义不是静态字面量');
  };
  let nodes=null;
  const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='createLucideIcon'&&node.arguments[0]?.text===name)nodes=literal(node.arguments[1]);ts.forEachChild(node,visit);};
  try{visit(source);}catch{return null;}
  if(!nodes?.length||nodes.some(([tag,attrs])=>!['path','circle','rect','line','polyline','polygon','ellipse'].includes(tag)||!attrs.key)||new Set(nodes.map(([,attrs])=>attrs.key)).size!==nodes.length)return null;
  return {name,file,sha256:sha256(text),nodes};
}
export function importedRenderMappings(project,text) {
 const source=ts.createSourceFile('source.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),mappings=new Map();
 for(const node of source.statements)if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='lucide-react')for(const item of node.importClause?.namedBindings?.elements || []) {
   if(item.isTypeOnly)continue;
   const map=lucideRenderMapping(project,item.propertyName?.text || item.name.text);if(map)mappings.set(item.name.text,map);
 }
 return mappings;
}

export function radixAvatarForwarding(project,part) {
 const file='node_modules/@radix-ui/react-avatar/dist/index.mjs';
 let text;try{text=fs.readFileSync(resolveProjectFile(project,file,'Avatar 渲染器'),'utf8');}catch{return null;}
 const contract={Root:['avatarProps','span'],Image:['imageProps','img'],Fallback:['fallbackProps','span']}[part];
 if(!contract)return null;
 const [props,tag]=contract;
 if(!new RegExp('\\.\\.\\.'+props+'\\s*\\}\\s*=\\s*props').test(text)||!new RegExp('jsx\\(Primitive\\.'+tag+',\\s*\\{\\s*\\.\\.\\.'+props+'[,}]').test(text))return null;
 return {file,sha256:sha256(text),part,rootTag:tag,forwardedProperties:props};
}
