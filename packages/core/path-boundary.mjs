import fs from 'node:fs';
import path from 'node:path';

export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function realProject(project) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('项目路径必须是绝对路径');
  const resolved = path.resolve(project);
  if (fs.existsSync(resolved) && fs.realpathSync(resolved) !== resolved) throw new Error('拒绝符号链接项目路径');
  return resolved;
}

export function normalizePublicPath(value, field) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\') || value.includes('\0')) throw new Error(`${field} 必须是以 / 开头的 URL 路径`);
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new Error(`${field} 包含无效 URL 编码`); }
  if (decoded.split('/').includes('..') || path.posix.normalize(decoded) !== decoded) throw new Error(`${field} 不得包含路径穿越`);
  return decoded;
}

export function resolveProjectFile(project, file, field, {mustExist = true} = {}) {
  const root = realProject(project);
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\\') || file.includes('\0') || file.split('/').includes('..')) throw new Error(`${field} 必须是项目内相对文件路径`);
  const resolved = path.resolve(root, file);
  if (!isWithin(root, resolved)) throw new Error(`${field} 解析后逃出项目根目录`);
  if (!fs.existsSync(resolved)) {
    if (mustExist) throw new Error(`${field} 引用的文件不存在：${file}`);
    return resolved;
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(resolved);
  if (!isWithin(realRoot, realFile)) throw new Error(`${field} 通过符号链接逃出项目根目录：${file}`);
  if (!fs.statSync(realFile).isFile()) throw new Error(`${field} 必须引用文件：${file}`);
  return realFile;
}
