import fs from 'node:fs';
import path from 'node:path';
import {buildViewModel} from './view-model.mjs';
import {WORKSPACE_ASSETS} from './workspace-assets.mjs';

const DIST = path.resolve(import.meta.dirname, '../../dist');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

export function workspaceDocument(data, previewConfig, {writeNonce = ''} = {}) {
  const model = buildViewModel(data, previewConfig);
  return workspaceModelDocument(model, {writeNonce});
}

export function workspaceModelDocument(model, {writeNonce = ''} = {}) {
  const serialized = JSON.stringify(model).replace(/</g, '\\u003c');
  const templatePath = path.join(DIST, 'index.html');
  const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';
  return template
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(model.project.name)} · Foundation 工作台</title>`)
    .replace('</head>', '<link rel="icon" href="data:,"></head>')
    .replace(/(?:\/|\.\/)?assets\/workspace\.css/g, WORKSPACE_ASSETS.stylesheet)
    .replace(/(?:\/|\.\/)?assets\/workspace\.js/g, WORKSPACE_ASSETS.script)
    .replace('</body>', `<script>window.__FOUNDATION_MODEL__=${serialized};window.__FOUNDATION_WRITE_NONCE__=${JSON.stringify(writeNonce).replace(/</g, '\\u003c')}</script></body>`);
}
