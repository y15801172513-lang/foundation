import fs from 'node:fs';
import path from 'node:path';
const fail=message=>{throw Object.assign(Error('错误：'+message),{code:'ACQUISITION_VALIDATION_FAILED'})};
export function plainPath(file) {
  if(!path.isAbsolute(file)||path.normalize(file)!==file)fail('路径必须是规范化绝对路径');
  for(let cursor=file;cursor!==path.dirname(cursor);cursor=path.dirname(cursor)){
    if(fs.existsSync(cursor)||fs.lstatSync(cursor,{throwIfNoEntry:false})){
      const s=fs.lstatSync(cursor);if(s.isSymbolicLink())fail('路径包含符号链接');
      if(fs.realpathSync(cursor)!==cursor)fail('路径真实位置不一致');
    }
  }
  return file;
}
