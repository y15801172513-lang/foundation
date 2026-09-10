import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Callers enumerate exact owned scopes/sentinels; never traverse a global .tmp.
// Symlinks are opaque leaves: snapshot link text, not their targets.
export function snapshotScopes(scopes) {
  const records = [];
  const visit = (file) => {
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (error.code === 'ENOENT') { records.push({path: file, type: 'missing'}); return; } throw error; }
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'unsupported';
    const bytes = type === 'file' ? fs.readFileSync(file) : type === 'symlink' ? Buffer.from(fs.readlinkSync(file)) : Buffer.alloc(0);
    records.push({path: file, type, mode: stat.mode & 0o7777, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')});
    if (type === 'directory') for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
  };
  for (const scope of [...new Set(scopes)].sort()) visit(scope);
  return records;
}
