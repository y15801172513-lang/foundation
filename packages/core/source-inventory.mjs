import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {realProject} from './path-boundary.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// No watcher or panel dependency. Call at task start/end, build completion and open.
// Unknown semantics are recorded as pending, never inferred as verified content.
export function inspectSyncSources(project) {
  const root = realProject(project), sources = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage', 'vendor'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|html|css|vue|svelte|swift|kt|dart)$/u.test(entry.name)) sources.push({path:path.relative(root,file).split(path.sep).join('/'),sha256:sha256(fs.readFileSync(file))});
    }
  };
  walk(root);
  return sources;
}
