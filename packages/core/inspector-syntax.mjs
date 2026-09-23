import {createRequire} from 'node:module';
const {ts}=createRequire(import.meta.url)('ts-morph');

// Offsets locate edits within the checked input bytes, never object identities.
export function inspectorSyntax(text,fileName) {
  const file=ts.createSourceFile(fileName,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const objects=new Map(),definitions=new Map(),imports=new Map();
  for(const node of file.statements)if(ts.isImportDeclaration(node))for(const item of node.importClause?.namedBindings?.elements || [])imports.set(item.name.text,{module:node.moduleSpecifier.text,export:item.propertyName?.text || item.name.text});
  const arrays=new Map();
  const scan=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isArrayLiteralExpression(node.initializer))arrays.set(node.name.text,node.initializer);ts.forEachChild(node,scan);};scan(file);
  const literal=node=>ts.isStringLiteral(node)||ts.isNumericLiteral(node)?node.text:null;
  const visit=node=>{
    if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)) {
      let definition=null,repetition=null;
      for(let parent=node.parent;parent;parent=parent.parent) {
        if(!repetition&&ts.isCallExpression(parent)&&ts.isPropertyAccessExpression(parent.expression)&&parent.expression.name.text==='map') {
          const callback=parent.arguments[0];
          let repeated=node;
          for(let ancestor=node.parent;ancestor&&ancestor!==callback;ancestor=ancestor.parent)if(ts.isJsxElement(ancestor)||ts.isJsxSelfClosingElement(ancestor))repeated=ancestor;
          const opening=ts.isJsxElement(repeated)?repeated.openingElement:repeated;
          const key=opening.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.text==='key');
          const expression=key?.initializer&&ts.isJsxExpression(key.initializer)?key.initializer.expression:null;
          const indexName=callback?.parameters?.[1]?.name.getText(file);
          const keyText=expression?.getText(file);
          const collection=parent.expression.expression;
          const array=ts.isArrayLiteralExpression(collection)?collection:ts.isIdentifier(collection)?arrays.get(collection.text):null;
          const parameter=callback?.parameters?.[0]?.name.getText(file);
          const property=expression&&ts.isPropertyAccessExpression(expression)&&expression.expression.getText(file)===parameter?expression.name.text:null;
          const keys=array?.elements.map(element=>property&&ts.isObjectLiteralExpression(element)?literal(element.properties.find(prop=>ts.isPropertyAssignment(prop)&&prop.name.getText(file)===property)?.initializer || element):keyText===parameter?literal(element):null);
          const values=keys?.every(key=>key!==null)&&new Set(keys).size===keys.length?keys:null;
          repetition={keyExpression:keyText || null,stable:Boolean(keyText&&keyText!==indexName&&!/^(?:index|idx|i)$/u.test(keyText)),values,start:parent.getStart(file)};
        }
        if(!definition&&ts.isFunctionDeclaration(parent)&&parent.name) {
          definition={name:parent.name.text,anchor:`decl:${parent.name.text}:function`};
          const parameter=parent.parameters[0];
          definitions.set(definition.anchor,{...definition,parameter:parameter&&ts.isObjectBindingPattern(parameter.name)?{offset:parameter.name.getStart(file)+1,hasScope:parameter.name.elements.some(item=>item.name.getText(file)==='foundationInstanceKey'),typeEnd:parameter.type?.end}:null});
        }
        if(!definition&&ts.isVariableDeclaration(parent)&&parent.initializer&&(ts.isArrowFunction(parent.initializer)||ts.isFunctionExpression(parent.initializer))) {
          definition={name:parent.name.getText(file),anchor:`decl:${parent.name.getText(file)}:variable`};
          const parameter=parent.initializer.parameters[0];
          definitions.set(definition.anchor,{...definition,parameter:parameter&&ts.isObjectBindingPattern(parameter.name)?{offset:parameter.name.getStart(file)+1,hasScope:parameter.name.elements.some(item=>item.name.getText(file)==='foundationInstanceKey'),typeEnd:parameter.type?.end}:null});
        }
      }
      const opening=ts.isJsxElement(node)?node.openingElement:node;
      let root=true;
      for(let ancestor=node.parent;ancestor&&!ts.isFunctionLike(ancestor);ancestor=ancestor.parent)if(ts.isJsxElement(ancestor))root=false;
      objects.set(node.getStart(file),{definition,repetition,root,tag:opening.tagName.getText(file)});
    }
    ts.forEachChild(node,visit);
  };
  visit(file);
  return {objects,definitions,imports,valid:file.parseDiagnostics.length===0};
}

export function inspectorSourceOwner(facts,object,syntax) {
  const components=facts.components.items.filter(item=>item.implementationMapping===object.file);
  const bound=components.filter(item=>item.assetModel?.binding?.anchor===syntax?.definition?.anchor);
  if(bound.length)return bound.length===1?bound[0]:null;
  // Unbound component definitions cannot be guessed from display names.
  if(components.some(item=>!item.assetModel?.binding))return null;
  const pages=facts.pages.items.filter(item=>item.implementationMapping===object.file || item.previewBinding?.inputs?.some(input=>input.path===object.file));
  return pages.length===1?pages[0]:null;
}
