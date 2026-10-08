import fs from 'node:fs';
import path from 'node:path';

export function currentRuntimeIdentity() {
  return Object.freeze({platform: process.platform, arch: process.arch});
}

export function operationCheckpoint() {}

export function effectiveDiskAvailability(actualBytes) {
  return actualBytes;
}

export function acquisitionNetworkDisconnected() {
  return false;
}

export function finalizerRuntimeEnvironment() {
  return Object.freeze({});
}

let maintenanceManagerRoot = null;
// Internal runtime binding, set only after the candidate and existing installation validate.
export function bindMaintenanceManagerRoot(root){if(maintenanceManagerRoot&&maintenanceManagerRoot!==root)throw Error('恢复记录根不能重绑定');maintenanceManagerRoot=root;}
export function currentManagerStateRoot() {
  if(maintenanceManagerRoot)return maintenanceManagerRoot;
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (!invoked) throw Object.assign(new Error('无法从当前 Foundation runtime 派生 manager state'), {code: 'MANAGER_RUNTIME_STATE_UNAVAILABLE'});
  let cursor = path.dirname(invoked);
  while (cursor !== path.dirname(cursor)) {
    const stateFile = path.join(cursor, 'state', 'current.json');
    if (fs.existsSync(stateFile) && fs.existsSync(path.join(cursor, 'versions'))) return path.join(cursor, 'state', 'local-manager');
    cursor = path.dirname(cursor);
  }
  throw Object.assign(new Error('当前进程不是已安装且可验证的 Foundation runtime；无法派生 manager state'), {code: 'MANAGER_RUNTIME_STATE_UNAVAILABLE'});
}
