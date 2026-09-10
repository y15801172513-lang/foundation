import fs from 'node:fs';
import path from 'node:path';

export const PRODUCT_MANIFEST = 'foundation-kit.json';

export function findProductRoot(start = import.meta.dirname) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, PRODUCT_MANIFEST))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`无法定位 ${PRODUCT_MANIFEST}`);
    current = parent;
  }
}

export function readProductManifest(root = findProductRoot()) {
  const file = path.join(path.resolve(root), PRODUCT_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!manifest?.product?.name || !/^\d+\.\d+\.\d+$/u.test(manifest?.product?.version || '')) throw new Error(`${PRODUCT_MANIFEST} 缺少有效 product.name/version`);
  return manifest;
}

export function productVersion(root = findProductRoot()) {
  return readProductManifest(root).product.version;
}

export function validateVersionMirrors(root = findProductRoot()) {
  const authority = productVersion(root);
  const files = ['package.json', 'packages/core/package.json', 'packages/cli/package.json', 'apps/management-center/package.json'];
  const mismatches = [];
  for (const file of files) {
    const version = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).version;
    if (version !== authority) mismatches.push({file, expected: authority, actual: version || null});
  }
  return {ok: mismatches.length === 0, authority, mismatches};
}
