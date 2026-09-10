import {previewPublicConfig, productVersion, projectAssets, projectGovernance, relationsVersion} from '@foundation/core';

export function buildViewModel(data, previewConfig) {
  const pages = data.pages.items.map((page) => ({...page, route: page.preview}));
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const relations = data.relations.items.map((relation) => ({...relation, fromName: relation.fromName || pageById.get(relation.from)?.name || relation.from, toName: relation.toName || pageById.get(relation.to)?.name || relation.to}));
  const components = data.components.items.map((component) => ({...component, usageLocations: component.usageLocations || []}));
  const entryPage = pages.find((page) => page.entry)?.id || null;
  const facts = {...data, pages: {...data.pages, items: pages}, components: {...data.components, items: components}};
  const assets = projectAssets(facts);
  return {foundationKit: {productVersion: productVersion(), versionAuthority: 'foundation-kit.json#/product/version'}, project: data.foundation, pages, relations, relationsVersion: relationsVersion(data.relations), components, assets, governance: projectGovernance(data.foundation), changes: data.changes.items, interactions: data.interactions.items, motions: data.motions.items, tokens: data['design-tokens'].items, figma: data.figma.items, entryPage, preview: previewPublicConfig(previewConfig)};
}
