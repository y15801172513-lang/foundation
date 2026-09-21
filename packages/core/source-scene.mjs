import {SCENE_RUNTIME_IMPORTS} from './scene-runtime-contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {analyzeSourcesInWorker} from './source-analysis.mjs';
import {resolveAssetBinding} from './asset-model.mjs';
import {resolveProjectFile} from './path-boundary.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';

// The compiler reads syntax only. Project modules/configuration are never executed
// in the host. Unsupported imports and top-level effects fail closed.
export function prepareSourceScene({project,facts,asset,scenario}) {
  if(!asset?.assetModel || scenario?.definitionId!==asset.id)throw new Error('场景缺少精确定义');
  const binding=asset.assetModel.binding;
  if(!binding?.export)throw new Error('场景仅支持明确的导出声明');
  const observation=analyzeSourcesInWorker({project,entryRoots:[binding.file]});
  const resolved=resolveAssetBinding(facts,observation).find(item=>item.assetId===asset.id);
  if(resolved?.state!=='bound')throw new Error('场景导出与当前声明绑定不一致');
  const usages=(asset.usageLocations || []).filter(item=>scenario.instanceId?item.instanceId===scenario.instanceId:scenario.configurationRef&&item.bindingId===scenario.configurationRef);
  if((scenario.kind==='instance'||scenario.configurationRef)&&usages.length!==1)throw new Error('场景实例配置缺少唯一来源');
  const configuration={...(usages[0]?.configuration || {}),...(scenario.variantValues || {})};
  if(Object.keys(configuration).some(key=>!asset.assetModel.configuration?.some(item=>item.key===key)&&!asset.assetModel.variantAxes?.some(item=>item.key===key)))throw new Error('场景包含未声明的配置');
  if(scenario.state && scenario.state!=='default')throw new Error('非默认状态尚无源码驱动配置，保留待核');
  const {ts}=createRequire(import.meta.url)('ts-morph'),modules=new Map(),inputs=[];
  const moduleUrl=file=>'./module-'+sha256(file).slice(0,24)+'.mjs';
  const literal=node=>ts.isLiteralExpression(node)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.kind)||ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isObjectLiteralExpression(node)&&node.properties.every(p=>ts.isPropertyAssignment(p)&&literal(p.initializer))||ts.isArrayLiteralExpression(node)&&node.elements.every(literal);
  const compile=file=>{
    if(modules.has(file))return;modules.set(file,null);
    const bytes=fs.readFileSync(resolveProjectFile(project,file)),text=bytes.toString('utf8');
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    if(ast.parseDiagnostics.length)throw new Error('场景源码语法不受支持');
    const replacements=[],namespaces=new Map();
    for(const statement of ast.statements){
      if(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement)) {
        const spec=statement.moduleSpecifier;if(!spec)continue;
        if(!ts.isStringLiteral(spec))throw new Error('场景模块引用必须为字面量');
        let replacement;
        if(SCENE_RUNTIME_IMPORTS[spec.text]){
          const contract=SCENE_RUNTIME_IMPORTS[spec.text],clause=statement.importClause;
          if(ts.isImportDeclaration(statement)){
            if(!clause)throw new Error('场景不支持无绑定 runtime 导入');
            if(clause.name){if(!contract.default)throw new Error('场景不支持 '+spec.text+' default 导入');namespaces.set(clause.name.text,contract);}
            const bindings=clause.namedBindings;
            if(bindings&&ts.isNamespaceImport(bindings)){if(!contract.namespace)throw new Error('场景不支持 '+spec.text+' namespace 导入');namespaces.set(bindings.name.text,contract);}
            else for(const item of bindings?.elements || [])if(!contract.named.includes(item.propertyName?.text || item.name.text))throw new Error('场景不支持导入 API：'+(item.propertyName?.text || item.name.text));
          }else{
            if(!statement.exportClause||!ts.isNamedExports(statement.exportClause))throw new Error('场景不支持 runtime 星号/namespace 重导出');
            for(const item of statement.exportClause.elements)if(!contract.named.includes(item.propertyName?.text || item.name.text))throw new Error('场景不支持重导出 API');
          }
          replacement='./'+contract.file;
        }
        else if(spec.text.startsWith('.')){
          const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec.text));
          const choices=[base,...['.tsx','.jsx','.ts','.js','/index.tsx','/index.jsx','/index.ts','/index.js'].map(ext=>base+ext)].filter(candidate=>{try{return fs.statSync(resolveProjectFile(project,candidate)).isFile();}catch{return false;}});
          if(choices.length!==1||!/\.[jt]sx?$/u.test(choices[0]))throw new Error('场景本地依赖不唯一或类型不受支持');
          compile(choices[0]);replacement=moduleUrl(choices[0]);
        }else throw new Error('场景外部依赖不受支持：'+spec.text);
        replacements.push({start:spec.getStart(ast),end:spec.end,text:JSON.stringify(replacement)});
      }else if(ts.isFunctionDeclaration(statement)||ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement)||ts.isEmptyStatement(statement)){}
      else if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.every(d=>d.initializer&&literal(d.initializer))){}
      else if(ts.isExportAssignment(statement)&&ts.isIdentifier(statement.expression)){}
      else throw new Error('场景拒绝模块顶层执行副作用');
    }
    const visit=node=>{if(ts.isIdentifier(node)&&namespaces.has(node.text)&&!ts.isImportClause(node.parent)&&!ts.isNamespaceImport(node.parent)&&!(ts.isPropertyAccessExpression(node.parent)&&node.parent.expression===node))throw new Error('场景 namespace 别名、解构或传递不受支持');if(ts.isPropertyAccessExpression(node)&&namespaces.has(node.expression.getText(ast))&&!namespaces.get(node.expression.getText(ast)).named.includes(node.name.text))throw new Error('场景 namespace API 不受支持：'+node.name.text);if(ts.isElementAccessExpression(node)&&namespaces.has(node.expression.getText(ast)))throw new Error('场景 namespace 动态成员不受支持');if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&['require','eval','Function'].includes(node.expression.text)))throw new Error('场景拒绝动态代码或模块依赖');ts.forEachChild(node,visit);};visit(ast);
    let rewritten=text;for(const change of replacements.sort((a,b)=>b.start-a.start))rewritten=rewritten.slice(0,change.start)+change.text+rewritten.slice(change.end);
    let output=ts.transpileModule(rewritten,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,removeComments:true}}).outputText;
    output=output.replaceAll('"react/jsx-runtime"','"./jsx-runtime.mjs"');
    const emitted=ts.createSourceFile('scene.js',output,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const canonical=node=>{ts.forEachChild(node,canonical);ts.setTextRange(node,{pos:-1,end:-1});if('multiLine' in node)node.multiLine=true;};canonical(emitted);output=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed}).printFile(emitted);
    modules.set(file,output);inputs.push({path:file,sha256:sha256(bytes)});
  };compile(binding.file);inputs.sort((a,b)=>a.path.localeCompare(b.path));
  const plan={schemaVersion:'1.0.0',producer:'foundation-source-scene/1',definitionId:asset.id,scenarioId:scenario.id,instanceId:scenario.instanceId || null,binding,configuration,inputs};
  const runtimePlan={definitionId:plan.definitionId,scenarioId:plan.scenarioId,instanceId:plan.instanceId,binding:{file:binding.file,export:binding.export},configuration,variantValues:scenario.variantValues || {}};
  const digest=sha256(canonicalStringify(plan)),renderDigest=sha256(canonicalStringify({runtimePlan,modules:[...modules]})),prefix='/__foundation/scenes/'+renderDigest+'/';
  const entry=`import React from './react.mjs';import {createRoot} from './react-dom-client.mjs';import * as exports from ${JSON.stringify(moduleUrl(binding.file))};import {mountAssetScene} from './bridge.mjs';const plan=${canonicalStringify(runtimePlan)};const query=new URLSearchParams(location.search);if(query.get('assetId')!==plan.definitionId||query.get('scenarioId')!==plan.scenarioId||(query.get('instanceId')||null)!==plan.instanceId)throw new Error('场景身份不匹配');if(JSON.stringify(JSON.parse(query.get('variantValues')||'{}'))!==JSON.stringify(plan.variantValues))throw new Error('场景配置不匹配');const Component=exports[plan.binding.export];if(typeof Component!=='function')throw new Error('当前导出不可渲染');await mountAssetScene({definitionId:plan.definitionId,scenarioId:plan.scenarioId,instanceId:plan.instanceId,render:async container=>{container.setAttribute('data-foundation-source-scene',${JSON.stringify(renderDigest)});const root=createRoot(container);root.render(React.createElement(Component,plan.configuration));return ()=>root.unmount();}});`;
  const resources=Object.fromEntries([...modules].map(([file,code])=>[prefix+moduleUrl(file).slice(2),{bytes:Buffer.from(code),mime:'text/javascript'}]));
  resources[prefix+'entry.mjs']={bytes:Buffer.from(entry),mime:'text/javascript'};
  resources[prefix+'index.html']={bytes:Buffer.from('<!doctype html><meta charset="utf-8"><script type="module" src="./entry.mjs"></script>'),mime:'text/html;charset=utf-8'};
  return {plan,digest,renderDigest,prefix,route:prefix+'index.html',resources};
}
