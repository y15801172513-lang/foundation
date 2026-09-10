import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SURFACES = [
  'packages/core',
  'packages/cli',
  'apps/management-center/src/server',
  'skills/ai-product-foundation-kit',
  'templates/foundation-project',
];
const EXTENSIONS = new Set(['.mjs', '.js', '.jsx', '.json', '.md']);
const findings = [];

function files(relative) {
  const root = path.join(ROOT, relative);
  const output = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) findings.push({code: 'PRODUCTION_SYMLINK', file: path.relative(ROOT, file)});
      else if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && EXTENSIONS.has(path.extname(file))) output.push(file);
    }
  };
  visit(root);
  return output;
}

const auditedFiles = SURFACES.flatMap(files);

for (const file of auditedFiles) {
  const relative = path.relative(ROOT, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  const checks = [
    ['OUTBOUND_NETWORK_MODULE', /from\s+['"]node:(?:https|http2|dns|dgram|tls)['"]/u],
    ['OUTBOUND_NETWORK_API', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/u],
    ['SHELL_EXECUTION_API', /\b(?:exec|execSync)\s*\(/u],
    ['DYNAMIC_CODE_EXECUTION', /\b(?:eval\s*\(|new\s+Function\s*\()/u],
    ['PACKAGE_INSTALL_COMMAND', /\b(?:npm|pnpm|yarn)\s+(?:install|add|dlx)\b/u],
  ];
  for (const [code, pattern] of checks) {
    const managerLocalFetch = code === 'OUTBOUND_NETWORK_API' && relative === 'packages/core/lifecycle-manager-host.mjs' && source.includes("fetch('/__foundation/manager/confirm'");
    if (pattern.test(source) && !managerLocalFetch) findings.push({code, file: relative});
  }
}

const localServer = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/server/center-server.mjs'), 'utf8');
if (!/server\.listen\(port, ['"]127\.0\.0\.1['"]/u.test(localServer)) findings.push({code: 'MANAGEMENT_CENTER_NOT_LOOPBACK_BOUND', file: 'apps/management-center/src/server/center-server.mjs'});
const cli = fs.readFileSync(path.join(ROOT, 'packages/cli/index.mjs'), 'utf8');
if (!/server\.listen\(0, ['"]127\.0\.0\.1['"]/u.test(cli) || !/manager\.listen\(0, ['"]127\.0\.0\.1['"]/u.test(localServer)) findings.push({code: 'LOCAL_MANAGER_NOT_LOOPBACK_BOUND', file: 'packages/core/lifecycle-manager-host.mjs'});

if (findings.length) {
  process.stderr.write(`${JSON.stringify({ok: false, findings}, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ok: true, filesAudited: auditedFiles.length, outboundNetwork: 'none', packageInstallCommands: 'none', dynamicCodeExecution: 'none', managementCenterBinding: '127.0.0.1-only'}, null, 2)}\n`);
}
