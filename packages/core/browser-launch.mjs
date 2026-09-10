import fs from 'node:fs';
import {spawn} from 'node:child_process';

export function openFoundationManagerUrl(url) {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/open')) return {opened: false, reason: 'system-browser-opener-unavailable'};
  try {
    const child = spawn('/usr/bin/open', [url], {detached: true, stdio: 'ignore', env: {PATH: ''}});
    child.unref();
    return {opened: true, method: '/usr/bin/open'};
  } catch (error) {
    return {opened: false, reason: error.code || 'browser-open-failed'};
  }
}
