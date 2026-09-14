import fs from 'node:fs';
import path from 'node:path';
import {canonicalStringify, sha256} from '@foundation/core';
import {ROOT} from './project-fixture.mjs';

// Synthetic legacy control-plane fixture, not the current distributable Skill.
// Old-version bridge tests must not bundle a Skill that requires newer commands.
export function writeLegacyCapabilityFixture(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/ai-product-foundation-kit/capability.json')));
  const content = '---\nname: ai-product-foundation-kit\ndescription: Synthetic legacy authority test fixture; not a user Skill.\n---\nRead-only fixture. Never install this test asset for users.\n';
  manifest.version = '0.2.0';
  manifest.requiredFoundationVersion = '>=0.2.0';
  manifest.files = [{path: 'SKILL.md', size: Buffer.byteLength(content), sha256: sha256(content)}];
  manifest.contentHash = sha256(canonicalStringify(manifest.files));
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, 'SKILL.md'), content);
  fs.writeFileSync(path.join(directory, 'capability.json'), JSON.stringify(manifest, null, 2) + '\n');
}
