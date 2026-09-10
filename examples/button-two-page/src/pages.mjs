import {createButtonElement, announcePreview, wireButtonPreview} from './button.mjs';

export function renderPage({pageId, title, intro, button}) {
  document.documentElement.dataset.foundationPageId = pageId;
  const main = document.createElement('main');
  main.className = 'preview-page';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Foundation demo';
  const heading = document.createElement('h1');
  heading.textContent = String(title);
  const paragraph = document.createElement('p');
  paragraph.textContent = String(intro);
  const footnote = document.createElement('div');
  footnote.className = 'preview-footnote';
  footnote.textContent = '点击按钮可同步当前组件';
  main.append(eyebrow, heading, paragraph, createButtonElement(document, button), footnote);
  document.body.replaceChildren(main);
  wireButtonPreview(window, document);
  announcePreview(window, pageId, location.pathname);
}
