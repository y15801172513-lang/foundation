import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Worker} from 'node:worker_threads';

export const analyzerVersion = 'foundation-source/1.2.0;ts-morph/26.0.0;typescript/5.8.3';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const jobs = new Map();
const caches = new Map();
const skipped = new Set(['node_modules', '.git', '.tmp', '.foundation', 'dist', 'build']);
const sourcePattern = /\.(?:[cm]?[jt]sx?|html)$/u;

function safeFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('源码分析路径必须为精确项目相对路径');
  let file = root;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`源码分析拒绝符号链接：${relative}`);
  }
  if (!fs.realpathSync(file).startsWith(root + path.sep)) throw new Error('源码分析路径越界');
  return file;
}

function inputsFor({project, entryRoots = ['src']}) {
  const root = fs.realpathSync(project);
  if (path.resolve(project) !== root) throw new Error('源码分析拒绝项目符号链接路径');
  const files = new Map();
  const diagnostics = [];
  const visit = (relative) => {
    const file = safeFile(root, relative), stat = fs.statSync(file);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file).sort()) if (!skipped.has(entry)) visit(`${relative}/${entry}`);
    } else if (stat.isFile() && sourcePattern.test(relative)) {
      const bytes = fs.readFileSync(file);
      files.set(relative, {path: relative, sha256: hash(bytes), text: bytes.toString('utf8')});
    } else if (stat.isFile() && /\.(vue|svelte|swift|kt)$/u.test(relative)) diagnostics.push({code:'UNSUPPORTED_LANGUAGE', file:relative, coverage:'unknown'});
  };
  for (const relative of entryRoots) visit(relative);
  const configs = [];
  for (const relative of ['tsconfig.json', 'jsconfig.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    if (!fs.existsSync(path.join(root, relative))) continue;
    const bytes = fs.readFileSync(safeFile(root, relative));
    configs.push({path:relative, sha256:hash(bytes), text:relative.endsWith('config.json') ? bytes.toString('utf8') : null});
  }
  return {root, files:[...files.values()], configs, diagnostics};
}

function digestInputs(input,options) {
  return hash(JSON.stringify({files:input.files.map(({path,sha256})=>({path,sha256})), configs:input.configs.map(({path,sha256})=>({path,sha256})), entryRoots:options.entryRoots, configDigest:options.configDigest || '', analyzerVersion}));
}

export function inspectSourceInputIdentity(options) {
  const input=inputsFor(options);
  return {inputDigest:digestInputs(input,options),inputs:[...input.files,...input.configs].map(({path,sha256})=>({path,sha256})),analyzerVersion};
}

// This is the only third-party compiler adapter. It operates on an in-memory
// snapshot: no user source, compiler plugin, or configuration code is executed.
export function analyzeSourcesInWorker(options) {
  const start = performance.now();
  const input = inputsFor(options);
  const inputDigest = digestInputs(input,options);
  const cached = caches.get(input.root);
  if (cached?.inputDigest === inputDigest) return {...cached.result, metrics:{...cached.result.metrics, cacheHit:true, elapsedMs:performance.now()-start}};
  const {Project, Node, SyntaxKind, ts} = createRequire(import.meta.url)('ts-morph');
  const diagnostics = [...input.diagnostics];
  const config = input.configs.find(x=>x.path === 'tsconfig.json') || input.configs.find(x=>x.path === 'jsconfig.json');
  let compilerOptions = {allowJs:true, checkJs:false, jsx:ts.JsxEmit.Preserve, target:ts.ScriptTarget.ESNext, module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler, skipLibCheck:true, lib:['lib.es2020.d.ts'], noEmit:true};
  if (config) {
    const parsed = ts.parseConfigFileTextToJson(config.path, config.text);
    if (parsed.error) diagnostics.push({code:'CONFIG_PARSE', message:ts.flattenDiagnosticMessageText(parsed.error.messageText,' ')});
    const raw = parsed.config || {};
    if (raw.extends || raw.references || raw.compilerOptions?.plugins) diagnostics.push({code:'CONFIG_PARTIAL', message:'extends/references/plugins 未执行；请提供解析后的安全配置与显式 entry roots'});
    const converted = ts.convertCompilerOptionsFromJson(raw.compilerOptions || {}, '/project');
    compilerOptions = {...compilerOptions, ...converted.options, noEmit:true};
    delete compilerOptions.plugins;
    for (const error of converted.errors) diagnostics.push({code:'CONFIG_OPTION', message:ts.flattenDiagnosticMessageText(error.messageText,' ')});
  }
  const configKey = hash(JSON.stringify(compilerOptions));
  const impacted=new Set(input.files.filter(file=>cached?.result.inputs.find(old=>old.path===file.path)?.sha256!==file.sha256).map(file=>file.path));
  for(const old of cached?.result.inputs || [])if(!input.files.some(file=>file.path===old.path))impacted.add(old.path);
  if(cached?.configKey===configKey) {
    let changed=true;
    while(changed){changed=false;for(const edge of cached.result.moduleEdges)if(impacted.has(edge.to)&&!impacted.has(edge.from)){impacted.add(edge.from);changed=true;}}
    for(const edge of cached.result.moduleEdges)if(impacted.has(edge.from))impacted.add(edge.to);
  }else for(const file of input.files)impacted.add(file.path);
  const graph = cached?.configKey === configKey ? cached.graph : new Project({useInMemoryFileSystem:true, compilerOptions, skipAddingFilesFromTsConfig:true, skipFileDependencyResolution:true});
  const present = new Set(input.files.map(x=>`/project/${x.path}`));
  for (const source of graph.getSourceFiles()) if (!present.has(source.getFilePath())) graph.removeSourceFile(source);
  for (const file of input.files) {
    if(file.path.endsWith('.html'))continue; // HTML bytes participate in identity, not the TS declaration graph.
    const existing = graph.getSourceFile(`/project/${file.path}`);
    if (!existing) graph.createSourceFile(`/project/${file.path}`, file.text);
    else if (existing.getFullText() !== file.text) existing.replaceWithText(file.text);
  }
  const relative = node => node.getSourceFile().getFilePath().slice('/project/'.length);
  const definitions = [], usages = [], moduleEdges = [], nodes = new Map();
  for (const source of graph.getSourceFiles()) {
    const exported = source.getExportedDeclarations();
    const exportsFor = node => [...exported].filter(([,values])=>values.includes(node)).map(([name])=>name);
    for (const node of source.getDescendants()) {
      const isFunction = Node.isFunctionDeclaration(node), isClass = Node.isClassDeclaration(node);
      const init = Node.isVariableDeclaration(node) ? node.getInitializer() : null;
      if (!isFunction && !isClass && !(init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init) || Node.isCallExpression(init)))) continue;
      const name = node.getName?.() || 'default';
      if (init && Node.isCallExpression(init) && !/^(?:.*\.)?(memo|forwardRef)$/u.test(init.getExpression().getText())) {
        if (/^[A-Z]/u.test(name)) diagnostics.push({code:'DYNAMIC_DEFINITION', file:relative(node), name, coverage:'unknown'});
        continue;
      }
      const declarationKind = isFunction ? 'function' : isClass ? 'class' : 'variable';
      const parents = node.getAncestors().filter(x=>Node.isFunctionDeclaration(x)||Node.isClassDeclaration(x)).map(x=>x.getName()||'default').reverse();
      const bodyHash = hash((node.getBody?.() || init || node).getText());
      const previous = options.previousIndex?.definitions || cached?.result.definitions || [];
      const equivalent = previous.filter(d=>d.file === relative(node) && d.bodyHash === bodyHash && d.declarationKind === declarationKind);
      const anchor = equivalent.length === 1 ? equivalent[0].anchor : `decl:${[...parents,name].join('/')}:${declarationKind}`;
      const bindingId = `${relative(node)}#${anchor}`;
      if (nodes.has(bindingId)) { diagnostics.push({code:'AMBIGUOUS_DECLARATION',file:relative(node),name}); continue; }
      const reusable=cached?.result.definitions.find(d=>d.bindingId===bindingId);
      if(reusable && !impacted.has(relative(node))){definitions.push(reusable);nodes.set(bindingId,node);continue;}
      let references = [];
      try { references = node.findReferencesAsNodes?.().map(ref=>({file:relative(ref),start:ref.getStart()})) || []; } catch (error) { diagnostics.push({code:'REFERENCES_PARTIAL',file:relative(node),message:error.message}); }
      const definition = {bindingId,file:relative(node),name,exports:exportsFor(node),declarationKind,anchor,line:node.getStartLineNumber(),bodyHash,type:node.getType().getText(node),references};
      definitions.push(definition);nodes.set(bindingId,node);
    }
    for (const entry of [...source.getImportDeclarations(),...source.getExportDeclarations().filter(entry=>entry.getModuleSpecifier())]) {
      const target = entry.getModuleSpecifierSourceFile();
      const kind=Node.isExportDeclaration(entry)?'re-export':'import';
      moduleEdges.push({kind,from:relative(source),to:target ? relative(target) : entry.getModuleSpecifierValue(),discovery:kind==='import'?'static-import':'static-export',coverage:target?'complete':'partial'});
      if (!target) diagnostics.push({code:'UNRESOLVED_MODULE',file:relative(source),specifier:entry.getModuleSpecifierValue()});
    }
  }
  const byNode = new Map([...nodes].map(([id,node])=>[node,id]));
  for (const source of graph.getSourceFiles()) for (const node of source.getDescendants()) {
    const jsx = Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node);
    if (!jsx && !Node.isCallExpression(node)) continue;
    const target = jsx ? node.getTagNameNode() : node.getExpression();
    if (!jsx && target.getKind() === SyntaxKind.ImportKeyword) {diagnostics.push({code:'DYNAMIC_IMPORT',file:relative(node),coverage:'unknown'});continue;}
    if (jsx && /^[a-z]/u.test(target.getText()) && !target.getText().includes('.')) continue;
    let symbol = target.getSymbol();
    try { symbol = symbol?.getAliasedSymbol() || symbol; } catch { /* non-alias symbol */ }
    const matched = (symbol?.getDeclarations() || []).map(d=>byNode.get(d)).filter(Boolean);
    if (!matched.length) {
      if (jsx) diagnostics.push({code:'UNRESOLVED_JSX',file:relative(node),name:target.getText(),coverage:'unknown'});
      continue;
    }
    for (const definitionId of matched) usages.push({bindingId:`use:${relative(node)}:${node.getStart()}`,definitionId,file:relative(node),line:node.getStartLineNumber(),kind:jsx?'jsx-use':'call-site',role:/(^|[\/.-])(preview|previews|stories)([\/.-]|$)/u.test(relative(node))?'preview-only':'source-use',expression:target.getText(),coverage:'static-not-runtime'});
  }
  // Syntactic and semantic compiler diagnostics remain visible; absence of a
  // runtime observation never upgrades an import or call to observed rendering.
  for (const diagnostic of graph.getPreEmitDiagnostics().slice(0,100)) diagnostics.push({code:`TS${diagnostic.getCode()}`,file:diagnostic.getSourceFile()?.getFilePath().replace('/project/','') || null,start:diagnostic.getStart(),message:ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText,' ')});
  // Binding coverage is narrower than whole-project type checking. It certifies
  // a concrete declaration and its resolved local calls, never its runtime behavior.
  for (const definition of definitions) {
    const node=nodes.get(definition.bindingId);
    const requiredUsages=usages.filter(use=>use.definitionId===definition.bindingId);
    const files=new Set([definition.file,...requiredUsages.map(use=>use.file)]);
    const relevant=diagnostics.filter(d=>{
      if(!d.file)return true;
      if(!files.has(d.file))return false;
      if(d.code==='UNRESOLVED_MODULE')return d.specifier.startsWith('.') || d.specifier.startsWith('/');
      // Missing external declarations do not erase a compiler-resolved local symbol.
      if(d.code==='TS2307')return false;
      if(d.code.startsWith('TS')&&d.file===definition.file&&d.start!==undefined)return d.start>=node.getStart()&&d.start<node.getEnd();
      return true;
    });
    for(const call of node.getDescendants().filter(Node.isCallExpression)) {
      const expression=call.getExpression();
      // An unresolved call directly producing the returned render value is a
      // relevant dynamic edge. Ordinary data transforms/hooks are not rendering proof.
      if(Node.isReturnStatement(call.getParent()) || node.getBody?.()===call) {
        let symbol=expression.getSymbol();try{symbol=symbol?.getAliasedSymbol()||symbol;}catch{}
        if(!(symbol?.getDeclarations() || []).some(d=>byNode.has(d)))relevant.push({code:'UNPROVEN_RENDER_CALL',file:definition.file,name:expression.getText(),coverage:'unknown'});
      }
    }
    const wrapper=node.getInitializer?.();
    if(wrapper&&Node.isCallExpression(wrapper)) {
      const name=wrapper.getExpression().getText();
      const imports=node.getSourceFile().getImportDeclarations();
      const reactWrapper=imports.some(entry=>entry.getModuleSpecifierValue()==='react' && (entry.getNamedImports().some(i=>(i.getAliasNode()?.getText()||i.getName())===name&&['memo','forwardRef'].includes(i.getName())) || /^(memo|forwardRef)$/u.test(name.split('.').at(-1))&&[entry.getDefaultImport()?.getText(),entry.getNamespaceImport()?.getText()].some(n=>n&&name.startsWith(n+'.'))));
      if(!reactWrapper)relevant.push({code:'UNPROVEN_WRAPPER',file:definition.file,name,coverage:'unknown'});
    }
    definition.coverage={state:relevant.length?'unknown':'proven-static',claim:'declaration-and-local-references',requiredFiles:[...files].sort(),provenUsages:requiredUsages.map(u=>u.bindingId).sort(),unknownEdges:relevant,unrelatedDiagnostics:diagnostics.filter(d=>!relevant.includes(d)),limitations:['不证明外部类型、语义、动态使用、运行或布局']};
  }
  const result = {definitions,usages,moduleEdges,diagnostics,coverage:{state:diagnostics.length?'partial':'complete',language:'js-ts',standardLibraries:compilerOptions.lib || 'project-default',externalTypes:'not-loaded',runtime:'unknown',styles:'unknown'},inputDigest,analyzerVersion,inputs:input.files.map(({path,sha256})=>({path,sha256})),metrics:{cacheHit:false,elapsedMs:performance.now()-start,rssBytes:process.memoryUsage().rss,fileCount:input.files.length,analyzedFiles:impacted.size}};
  caches.set(input.root,{graph,configKey,inputDigest,result});
  while(caches.size>2)caches.delete(caches.keys().next().value);
  return result;
}

export async function analyzeSources(options) {
  const project = fs.realpathSync(options.project);
  let job = jobs.get(project);
  if (!job) {
    const worker = new Worker(new URL('./source-analysis-worker.mjs', import.meta.url));
    job = {worker, tail:Promise.resolve(),sequence:0,idle:null,pending:0}; jobs.set(project,job);
    worker.on('exit',()=>{if(jobs.get(project)===job)jobs.delete(project);});
  }
  clearTimeout(job.idle);
  job.pending++;
  const operation = job.tail.then(()=>new Promise(resolve=>{
    job.worker.ref();
    const id = ++job.sequence;
    const finish = result => {clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);job.worker.off('message',onMessage);job.worker.off('error',onError);resolve(result);};
    const partial = message => ({definitions:[],usages:[],moduleEdges:[],diagnostics:[{code:'ANALYSIS_INCOMPLETE',message}],coverage:{state:'partial',runtime:'unknown'},inputDigest:null,analyzerVersion});
    const onMessage = message => {if(message.id===id)finish(message.result || partial(message.error));};
    const onError = error => finish(partial(error.message));
    const onAbort=()=>{job.dead=true;job.worker.terminate();finish(partial('源码分析已取消；保留已有事实'));};
    const timer = setTimeout(()=>{job.dead=true;job.worker.terminate();finish(partial('源码分析超过 10 秒；保留已有事实'));},10000);
    if(job.dead||options.signal?.aborted){finish(partial('源码分析已取消；保留已有事实'));return;}
    options.signal?.addEventListener('abort',onAbort,{once:true});
    job.worker.on('message',onMessage);job.worker.once('error',onError);
    const {signal,...workerOptions}=options;
    job.worker.postMessage({id,options:{...workerOptions,project}});
  }));
  job.tail = operation.catch(()=>{});
  const result = await operation;
  if(--job.pending===0){job.idle = setTimeout(()=>job.worker.terminate(),30000);job.idle.unref();job.worker.unref();}
  return result;
}
