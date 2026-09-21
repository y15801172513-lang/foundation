import {createRequire} from 'node:module';
import {sha256,canonicalStringify} from './install-contract.mjs';
const digest=value=>sha256(canonicalStringify(value));
export function sourceSemanticDigest(file,bytes) {
  const text=bytes.toString('utf8');
  if(/\.[cm]?[jt]sx?$/u.test(file)) {
    const {ts}=createRequire(import.meta.url)('ts-morph');
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,/x$/u.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    if(!ast.parseDiagnostics.length){const shape=node=>{const children=[];ts.forEachChild(node,child=>{children.push(shape(child));});return {kind:node.kind,...(!children.length&&typeof node.text==='string'?{text:node.text}:{}),children};};return digest(shape(ast));}
  }
  // No guessed whitespace equivalence for CSS selectors, HTML text or unknown languages.
  return sha256(bytes);
}
