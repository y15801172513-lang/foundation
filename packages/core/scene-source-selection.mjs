import {createRequire} from 'node:module';
const {ts}=createRequire(import.meta.url)('ts-morph');

// Preserve the selected declaration and its syntactic dependencies. Only the
// recognized application mount is excluded; unknown top-level effects reject.
export function selectSceneSource(text,fileName,exportName) {
  const file=ts.createSourceFile(fileName,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=new Map(),imports=[],others=[];
  for(const statement of file.statements) {
    if(ts.isImportDeclaration(statement)){imports.push(statement);continue;}
    if(statement.name&&ts.isIdentifier(statement.name)){declarations.set(statement.name.text,statement);continue;}
    if(ts.isVariableStatement(statement)){for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name))declarations.set(d.name.text,statement);continue;}
    if(ts.isExpressionStatement(statement)&&/^createRoot\(document\.getElementById\([\s\S]*\)!?\)\.render\(/u.test(statement.expression.getText(file)))continue;
    if(ts.isEmptyStatement(statement))continue;
    others.push(statement);
  }
  if(!declarations.has(exportName))return text;
  if(others.length)throw new Error('独立场景不支持未解析的模块顶层副作用或重导出');
  const selected=new Set(),names=new Set([exportName]);
  let changed=true;
  while(changed){changed=false;for(const name of [...names]){const statement=declarations.get(name);if(!statement||selected.has(statement))continue;selected.add(statement);changed=true;const visit=node=>{if(ts.isIdentifier(node))names.add(node.text);ts.forEachChild(node,visit);};visit(statement);}}
  const printer=ts.createPrinter(),result=[];
  for(const statement of imports) {
    const clause=statement.importClause;if(!clause)continue;
    const bindings=clause.namedBindings;
    const filtered=bindings&&ts.isNamedImports(bindings)?ts.factory.updateNamedImports(bindings,bindings.elements.filter(item=>names.has(item.name.text))):bindings&&names.has(bindings.name.text)?bindings:undefined;
    const defaultName=clause.name&&names.has(clause.name.text)?clause.name:undefined;
    if(!defaultName&&(!filtered||ts.isNamedImports(filtered)&&!filtered.elements.length))continue;
    const next=ts.factory.updateImportDeclaration(statement,statement.modifiers,ts.factory.updateImportClause(clause,clause.isTypeOnly,defaultName,filtered),statement.moduleSpecifier,statement.attributes);
    result.push(printer.printNode(ts.EmitHint.Unspecified,next,file));
  }
  result.push(...file.statements.filter(statement=>selected.has(statement)).map(statement=>statement.getText(file)));
  return result.join('\n');
}
