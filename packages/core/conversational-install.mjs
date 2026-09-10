import fs from 'node:fs';
import path from 'node:path';
import {inspectInstallDestination} from './install-destination.mjs';
import {resolveFoundationPlatformPaths} from './platform-paths.mjs';
import {inspectInstallation} from './transaction-engine.mjs';
import {validateCandidate} from './candidate-package.mjs';

// A user Skill locator is a routing hint, never proof of installation or a
// permission to execute its contents. No recursive home/project scanning.
export function readCodexInstallationHint(home) {
  const directory = path.join(home, '.agents', 'skills', 'ai-product-foundation-kit');
  const file = path.join(directory, 'foundation-installation.json');
  try {
    let cursor = home;
    for (const part of path.relative(home, file).split(path.sep)) {
      cursor = path.join(cursor, part);
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || fs.realpathSync(cursor) !== cursor || stat.uid !== process.getuid()) throw new Error('路径或归属发生变化');
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) throw new Error('位置线索不是有界普通文件');
    const hint = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Object.keys(hint).sort().join('|') !== ['authority','installId','installationRoot','resolver','schemaVersion'].sort().join('|') || hint.schemaVersion !== '1.0.0' || hint.authority !== 'discovery-hint-only' || hint.resolver !== 'installed-current' || typeof hint.installId !== 'string' || !/^install-[a-f0-9]+$/u.test(hint.installId)) throw new Error('位置线索格式不符');
    if (!inspectInstallDestination(hint.installationRoot).exists) throw new Error('安装位置已移动或不存在');
    return {status:'hint-found', file, installationRoot:hint.installationRoot, installId:hint.installId, verifiedInstallation:false, executionPerformed:false};
  } catch (error) {
    return {status:error.code === 'ENOENT' ? 'absent-or-moved' : 'invalid', file, installationRoot:null, verifiedInstallation:false, executionPerformed:false};
  }
}

// Inspection never creates bootstrap state, repairs locks, or activates authority.
export function inspectConversationalInstall({destination = null, candidateRoot = null} = {}) {
  const blockers = [];
  let paths = null;
  try { paths = resolveFoundationPlatformPaths(); }
  catch (error) { blockers.push({code: error.code || 'PLATFORM_INSPECTION_FAILED', message: error.message}); }
  const discovery = paths ? readCodexInstallationHint(paths.homeRealPath) : null;
  let target = null;
  const proposed = destination || discovery?.installationRoot || paths?.installRoot;
  if (proposed) {
    try { target = inspectInstallDestination(proposed); }
    catch (error) { blockers.push({code: error.code || 'DESTINATION_INSPECTION_FAILED', message: error.message}); }
  }
  let installation = null;
  if (target?.exists && !target.empty) {
    try { installation = inspectInstallation(target.realPath); }
    catch (error) { blockers.push({code: error.code || 'INSTALLATION_UNVERIFIED', message: '目录非空，无法在当前 authority 下验证已有安装；不得覆盖'}); }
    if (installation?.installed !== true) blockers.push({code: 'DESTINATION_NOT_EMPTY', message: '目录包含既有内容；请另选空目录或单独诊断现有安装'});
  }
  let candidate = null;
  if (candidateRoot) {
    const checked = validateCandidate(candidateRoot, {platform: process.platform, arch: process.arch, requireRuntime: true});
    if (checked.ok) candidate = {version: checked.manifest.productVersion, hash: checked.manifest.candidateHash, bytes: checked.manifest.totalBytes, runtime: checked.manifest.runtime, signature: checked.manifest.signature};
    else blockers.push(checked.error);
  }
  const skillDirectory = paths ? path.join(paths.homeRealPath, '.agents', 'skills', 'ai-product-foundation-kit') : null;
  return {
    schemaVersion: '1.0.0', operation: 'inspect', status: blockers.length ? 'INSPECTION_BLOCKED' : 'INSPECTION_COMPLETE',
    platform: process.platform, arch: process.arch,
    supportedPlatform: process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch),
    suggestedDirectory: paths?.installRoot || null, destination: target, discovery,
    existingInstallationCheck: target?.exists && !target.empty ? {required:true, entry:'verified-candidate-install-routes-to-verified-installed-authority', destination:target.realPath, duplicateInstallAllowed:false, automaticConfirmation:false} : null,
    installation, candidate, availableVersions: [],
    localInstallationStatus: installation?.installed === true ? 'installed-see-health' : target?.exists && !target.empty ? 'unverified' : target ? 'not-installed' : 'unknown',
    versionAvailability: 'not-loaded; selectable versions come only from the trusted GitHub conversational entry catalog, never a local candidate',
    release: {remoteQuery: 'not-checked', remoteAcquisition: 'not-checked', publication: 'unknown', independentSignature: candidate?.signature?.status || 'not-checked'},
    remoteExistenceVerified: false,
    skill: {name: 'ai-product-foundation-kit', scope: 'user', proposedDirectory: skillDirectory, existingContent: skillDirectory ? fs.existsSync(skillDirectory) : null, registered: 'unknown', discovery: 'requires-host-verification', authorizationRequired: true},
    projects: {scanCount: 0, modifications: 'none', defaultState: 'unmanaged'},
    blockers, mutationPerformed: false, managerStateMutationPerformed: false,
  };
}
