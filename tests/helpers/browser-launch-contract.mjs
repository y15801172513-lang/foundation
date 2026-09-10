import fs from 'node:fs';
import path from 'node:path';

const BASE_ARGUMENTS = [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
];

export function browserLaunchContract(environment = process.env, options = {}) {
  const rawOptIn = environment?.FOUNDATION_BROWSER_NO_SANDBOX;
  if (rawOptIn !== undefined && rawOptIn !== '' && rawOptIn !== '1') {
    throw new Error(`FOUNDATION_BROWSER_NO_SANDBOX 只能精确设置为 1；收到 ${JSON.stringify(rawOptIn)}`);
  }

  const explicitNoSandbox = rawOptIn === '1';
  const args = [...BASE_ARGUMENTS];
  if (explicitNoSandbox) args.splice(1, 0, '--no-sandbox');
  if (options.windowSize) args.push(`--window-size=${options.windowSize}`);
  if (options.userDataDirectory) args.push(`--user-data-dir=${options.userDataDirectory}`);
  args.push(options.url || 'about:blank');

  return {
    args,
    sandboxMode: explicitNoSandbox ? 'explicit-no-sandbox' : 'default',
    optInSource: explicitNoSandbox ? 'FOUNDATION_BROWSER_NO_SANDBOX=1' : null,
  };
}

export async function waitForBrowserDevtoolsPort(profile, child, {attempts = 200, intervalMilliseconds = 50} = {}) {
  const marker = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (fs.existsSync(marker)) {
      try { return Number(fs.readFileSync(marker, 'utf8').split(/\r?\n/u)[0]); }
      catch (error) { if (error.code !== 'EBUSY') throw error; }
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`浏览器在开放 DevTools 前退出：exitCode=${child.exitCode ?? 'none'} signalCode=${child.signalCode ?? 'none'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMilliseconds));
  }
  throw new Error(`浏览器未在限定时间内开放 DevTools 端口：exitCode=${child.exitCode ?? 'running'} signalCode=${child.signalCode ?? 'none'}`);
}
