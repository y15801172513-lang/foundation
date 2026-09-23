import {projectObjectRelations} from '@foundation/core';
import {previewPublicConfig, productVersion, projectAssets, projectGovernance, relationsVersion} from '@foundation/core';

export function buildViewModel(data, previewConfig) {
  const pages = data.pages.items.map((page) => ({...page, route: page.route || page.preview, ...(previewConfig.mode === 'unconfigured' ? {preview: null} : {})}));
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const relations = data.relations.items.map((relation) => ({...relation, fromName: relation.fromName || pageById.get(relation.from)?.name || relation.from, toName: relation.toName || pageById.get(relation.to)?.name || relation.to}));
  const components = data.components.items.map((component) => ({...component, usageLocations: component.usageLocations || []}));
  const entryPage = pages.find((page) => page.entry)?.id || null;
  const facts = {...data, pages: {...data.pages, items: pages}, components: {...data.components, items: components}};
  const assets = projectAssets(facts).map(asset=>({...asset,scenarioRoutes:Object.fromEntries((asset.assetModel?.previewScenarios || []).flatMap(scenario=>{
    const routes=(previewConfig.routes || []).filter(route=>scenario.adapter && route.file===scenario.adapter);
    const route=routes.find(route=>route.path===asset.previewRoute) || routes[0];
    return route?[[scenario.id,route.path]]:[];
  }))}));
  return {synchronization: data.synchronization || null,foundationKit: {productVersion: productVersion(), versionAuthority: 'foundation-kit.json#/product/version'}, project: {...data.foundation,deliveryAssessment:data.delivery?.assessment || null}, delivery: data.delivery || null, pages, relations, objectRelations:projectObjectRelations(data),semanticRevision:data.semanticRevision || null,objectIdentities:data.delivery?.objectIdentities || data.objectIdentities || [], relationsVersion: relationsVersion(data.relations), components, assets, governance: projectGovernance(data.foundation), changes: data.changes.items, interactions: data.interactions.items, motions: data.motions.items, tokens: data['design-tokens'].items, figma: data.figma.items, entryPage, preview: previewPublicConfig(previewConfig)};
}
