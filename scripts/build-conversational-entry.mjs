import fs from 'node:fs';
import path from 'node:path';
import {renderGitHubConversationalEntry} from '../packages/core/conversational-entry-template.mjs';
import {sha256} from '../packages/core/install-contract.mjs';

// Local build only; never creates a release key or changes the pinned policy.
try {
  const [flag, input, outputFlag, output, ...extra] = process.argv.slice(2);
  if (flag === '--catalog') throw new Error('DEFERRED_SIGNED_ENTRY：旧独立签名入口已暂缓；不会回退。当前仅支持 --github-catalog');
  if (flag !== '--github-catalog' || outputFlag !== '--output' || !input || !output || extra.length) throw new Error('用法：--github-catalog <release-index.json> --output <新 .sh>');
  const root = fs.realpathSync(path.resolve(import.meta.dirname, '..', '.tmp'));
  const target = path.resolve(output);
  if (!target.startsWith(root + path.sep) || !target.endsWith('.sh') || fs.existsSync(target) || fs.existsSync(target + '.json') || fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error('仅写当前项目 .tmp 内的新文件；拒绝覆盖和符号链接');
  const source = fs.realpathSync(input);
  if (fs.statSync(source).size > 1024 * 1024) throw new Error('清单过大');
  const script = renderGitHubConversationalEntry(JSON.parse(fs.readFileSync(source, 'utf8')));
  fs.writeFileSync(target, script, {flag: 'wx', mode: 0o700});
  const receipt = {schemaVersion:'1.0.0', sha256:sha256(script), catalogSha256:sha256(fs.readFileSync(source)), published:false, runtimeOnPathRequired:false, productionTrust: 'fixed-github-release-attestation-required-at-acquisition', remoteAcquisitionVerified:false};
  fs.writeFileSync(target + '.json', JSON.stringify(receipt, null, 2) + '\n', {flag:'wx', mode:0o600});
  console.log(JSON.stringify({output: target, ...receipt}, null, 2));
} catch (error) { console.error(`错误：${error.code || 'ENTRY_BUILD_FAILED'}：${error.message}`); process.exitCode = 1; }
