import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

// Build-time only. Inputs come from the bundlers, never a runtime download.
// Keep package names and license bytes, not the builder's absolute paths.
export function thirdPartyNotices(inputs, root) {
  const boundary = fs.realpathSync(root);
  const packages = new Map();
  for (const input of inputs) {
    const file = path.resolve(boundary, input.split('?')[0]);
    if (!file.includes(`${path.sep}node_modules${path.sep}`) || !fs.existsSync(file)) continue;
    const real = fs.realpathSync(file);
    if (!real.startsWith(boundary + path.sep)) throw new Error('第三方许可输入越出构建边界');
    let directory = fs.statSync(real).isDirectory() ? real : path.dirname(real);
    while (directory !== boundary && !fs.existsSync(path.join(directory, 'package.json'))) directory = path.dirname(directory);
    if (directory === boundary) throw new Error('第三方许可输入缺少 package.json');
    const info = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (info.name?.startsWith('@foundation/')) continue;
    const key = `${info.name}@${info.version}`;
    const files = fs.readdirSync(directory).filter(name => /^(license|licence|copying|notice)(?:[.-].*)?$/i.test(name)).sort();
    if (!files.length) throw new Error(`发行缺少第三方完整许可文本：${key}`);
    const texts = files.map(name => {
      const target = path.join(directory, name);
      if (!fs.lstatSync(target).isFile()) throw new Error(`第三方许可不是普通文件：${key}/${name}`);
      return `${name}\n${fs.readFileSync(target, 'utf8').trimEnd()}`;
    });
    const value = `${key}\nDeclared license: ${typeof info.license === 'string' ? info.license : 'see license text'}\n\n${texts.join('\n\n')}`;
    if (packages.has(key) && packages.get(key) !== value) throw new Error(`同版本第三方许可内容冲突：${key}`);
    packages.set(key, value);
  }
  return `Third-party software notices\nGenerated from actual bundled module inputs. Each dependency retains its own terms.\nThis document does not grant a license to Foundation itself.\n\n${[...packages].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value).join('\n\n--------------------\n\n')}\n`;
}

export function bundledLicensePlugin(root) {
  return {
    name: 'foundation-bundled-license-notices',
    generateBundle() {
      // CSS/font asset imports may be absent from getModuleIds after Vite's
      // asset transformation. Geist is explicitly shipped by this UI profile.
      const font = createRequire(path.join(root, 'package.json')).resolve('@fontsource-variable/geist/package.json');
      this.emitFile({type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: thirdPartyNotices([...this.getModuleIds(), font], root)});
    },
  };
}
