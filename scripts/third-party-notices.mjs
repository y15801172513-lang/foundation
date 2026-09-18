import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export function productionDependencyClosure(root, names) {
  const boundary=fs.realpathSync(root), found=new Map();
  const visit=(name,from)=>{
    const require=createRequire(path.join(from,'package.json'));
    let file;
    try {file=require.resolve(`${name}/package.json`);} catch {file=require.resolve(name);}
    let directory=path.dirname(fs.realpathSync(file));
    while(directory.startsWith(boundary+path.sep)) {
      const candidate=path.join(directory,'package.json');
      if(fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate,'utf8')).name===name)break;
      directory=path.dirname(directory);
    }
    if(!directory.startsWith(boundary+path.sep) || !directory.includes(`${path.sep}node_modules${path.sep}`))throw new Error(`生产依赖解析越界：${name}`);
    if(found.has(directory))return;
    const info=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
    const relative=path.relative(boundary,directory).split(path.sep).join('/');
    const lock=JSON.parse(fs.readFileSync(path.join(boundary,'package-lock.json'),'utf8')).packages[relative];
    if(lock?.version!==info.version || !lock.integrity)throw new Error(`生产依赖缺精确锁身份：${name}`);
    found.set(directory,{directory,relative,name:info.name,version:info.version,integrity:lock.integrity,license:info.license});
    for(const dependency of Object.keys(info.dependencies || {}).sort())visit(dependency,directory);
  };
  for(const name of names)visit(name,boundary);
  return [...found.values()].sort((a,b)=>a.relative.localeCompare(b.relative));
}

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
    if(info.name==='@ts-morph/common') {
      if(info.version!=='0.27.0')throw new Error('内嵌 TypeScript 版本需要重新核验许可');
      const noticeRoot=path.join(boundary,'packages/core/notices/typescript-5.8.3');
      for(const name of ['LICENSE.txt','ThirdPartyNoticeText.txt'])texts.push(`Embedded TypeScript 5.8.3 — Apache-2.0 — ${name}\n${fs.readFileSync(path.join(noticeRoot,name),'utf8')}`);
    }
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
