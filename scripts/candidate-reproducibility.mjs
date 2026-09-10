import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const candidate = path.resolve(process.argv[2] || '');
const manifestFile = path.join(candidate, 'manifest.json');
const payload = path.join(candidate, 'payload');
if (!fs.existsSync(manifestFile) || !fs.existsSync(payload)) throw new Error('candidate-reproducibility requires a candidate root');

const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`candidate contains symlink: ${absolute}`);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile()) files.push(absolute);
    else throw new Error(`candidate contains special file: ${absolute}`);
  }
}
visit(candidate);

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const treeRecords = [];
const contentRecords = [];
const archive = crypto.createHash('sha256');
archive.update('foundation-deterministic-archive-v1\0');
for (const file of files) {
  const relative = path.relative(candidate, file).replaceAll(path.sep, '/');
  const content = fs.readFileSync(file);
  const mode = fs.statSync(file).mode & 0o777;
  const fileHash = digest(content);
  treeRecords.push(`${relative}\0${mode}\0${content.length}\0${fileHash}`);
  contentRecords.push(`${relative}\0${fileHash}`);
  const header = Buffer.from(`${relative.length}:${relative}:${mode}:${content.length}:`, 'utf8');
  archive.update(header);
  archive.update(content);
  archive.update('\0');
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
process.stdout.write(`${JSON.stringify({
  schemaVersion: '1.0.0',
  fileCount: files.length,
  candidateContentHash: manifest.candidateHash,
  treeHash: digest(treeRecords.join('\n')),
  contentInventoryHash: digest(contentRecords.join('\n')),
  deterministicArchiveFormat: 'foundation-deterministic-archive-v1',
  deterministicArchiveHash: archive.digest('hex'),
}, null, 2)}\n`);
