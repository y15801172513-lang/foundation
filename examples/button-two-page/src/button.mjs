export const BUTTON_FAMILY = 'Button';
export const BUTTON_SOURCE = 'examples/button-two-page/src/button.mjs';

export function createButtonElement(document, {instanceId, variant='primary', label, target}) {
  const link = document.createElement('a');
  link.className = `foundation-button foundation-button--${variant}`;
  link.dataset.foundationComponentId = 'component_button';
  link.dataset.foundationInstanceId = String(instanceId);
  link.dataset.foundationVariant = String(variant);
  link.href = String(target);
  const text = document.createElement('span');
  text.textContent = String(label);
  link.append(text);
  return link;
}

export function announcePreview(win, pageId, route) {
  win.parent.postMessage({namespace:'ai-product-foundation-preview',kind:'preview-ready',pageId,route}, win.location.origin);
}

export function announceComponent(win, instanceId, componentId, pageId, variant) {
  win.parent.postMessage({namespace:'ai-product-foundation-preview',kind:'component-selected',instanceId,componentId,pageId,variant}, win.location.origin);
}

export function wireButtonPreview(win, document) {
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-foundation-component-id]');
    if (!link) return;
    announceComponent(win, link.dataset.foundationInstanceId, link.dataset.foundationComponentId, document.documentElement.dataset.foundationPageId, link.dataset.foundationVariant);
  });
  win.addEventListener('message', event => {
    if (event.origin !== win.location.origin || event.source !== win.parent || event.data?.namespace !== 'ai-product-foundation-preview') return;
    if (event.data.kind !== 'select-component') return;
    const node = document.querySelector(`[data-foundation-instance-id="${CSS.escape(event.data.instanceId)}"]`);
    document.querySelectorAll('.foundation-preview-selected').forEach(el => el.classList.remove('foundation-preview-selected'));
    if (node) { node.classList.add('foundation-preview-selected'); node.scrollIntoView({block:'center',behavior:'smooth'}); }
  });
}
