// Pure product-content projection. Drafts stay readable; consistency is not acceptance.
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value.trim().length > 0;
const na = value => value?.state === 'not-applicable' && text(value.reason) && text(value.source);
export function inspectContentIntegrity(facts = {}, {requireCoverage = false} = {}) {
  const issues = [];
  const add = (object, field, state = 'missing') => issues.push({id: `content:${object.id || object.assetId || 'task'}:${field}:${state}`, objectId: object.id || object.assetId || 'task', field, state, impact: '本次内容交付未就绪', nextStep: `补充或复核 ${field}`, message: `${object.name || object.id || '任务'}：${field} ${state === 'missing' ? '尚未登记' : state}`});
  const rows = kind => list(facts[kind]?.items);
  const pages = rows('pages'), pageIds = new Set(pages.map(x => x.id));
  const all = Object.values(facts).flatMap(x => list(x?.items));
  const byId = new Map(all.map(x => [x.id, x]));
  for (const item of all) if (item.synchronization?.state === 'pending') add(item, 'source-review', 'pending');
  for (const kind of ['pages', 'components', 'interactions', 'motions']) for (const item of rows(kind)) {
    if (!text(item.name)) add(item, 'name');
    if (!text(item.implementationMapping || item.implementationPath)) add(item, 'implementationMapping');
    for (const state of ['missing', 'pending', 'conflicts']) for (const field of list(item[state])) add(item, field, state === 'conflicts' ? 'conflict' : state);
    if (item.synchronization?.state === 'pending') add(item, 'source-review', 'pending');
    if (kind === 'components') {
      if (!text(item.assetModel?.responsibility || item.responsibility || item.description || item.summary)) add(item, 'purpose');
      const usages = list(item.usageLocations);
      if (!usages.length && !na(item.usageApplicability)) add(item, 'usageLocations');
      for (const usage of usages) if (!pageIds.has(usage.pageId) || !text(usage.location || usage.selector || usage.instanceId)) add(item, 'usageLocations', 'unknown');
      if (!list(item.variants).length && !item.variant && !item.assetModel?.variantAxes && !na(item.variantsApplicability)) add(item, 'variantsApplicability');
      if (item.previewRequirement === 'independent' && !item.previewRoute) add(item, 'previewRoute');
    }
    if (kind === 'pages') {
      if (!item.entry && !text(item.entryType)) add(item, 'entryType');
      if (!rows('relations').some(r => r.from === item.id || r.to === item.id) && !na(item.navigationApplicability)) add(item, 'navigationApplicability');
      if (!list(item.states).length && !na(item.statesApplicability)) add(item, 'statesApplicability');
    }
    if (kind === 'interactions') {
      if (!list(item.pageIds).some(id => pageIds.has(id)) && !(item.scope === 'cross-page' && text(item.scopeReason))) add(item, 'pageIds');
      for (const field of ['trigger', 'initialState', 'targetState', 'description']) if (!text(item[field])) add(item, field);
      for (const field of list(item.requiredRecoveryStates)) if (!text(item.recoveryStates?.[field])) add(item, `recoveryStates.${field}`);
    }
  }
  const scopes = rows('changes').filter(x => x.deliveryScope);
  if (requireCoverage && !scopes.length) add({id: 'task'}, 'deliveryScope');
  for (const change of scopes) {
    const scope = change.deliveryScope;
    if(scope.schemaVersion==='2.0.0') {
      if(!scope.items?.length || !scope.sourceRefs?.length)add(change,'deliveryScope');
      for(const item of scope.items || []) {
        if(na(item.applicability))continue;
        if(!item.factIds?.length || item.factIds.some(id=>!byId.has(id)))add({id:item.requirementId},'factIds');
      }
      continue;
    }
    if (scope.schemaVersion !== '1.0.0' || !list(scope.items).length || !text(scope.requirementSource)) { add(change, 'deliveryScope'); continue; }
    const seen = new Set();
    for (const item of scope.items) {
      if (!text(item.id) || seen.has(item.id)) add(change, 'scope-item-id', 'conflict');
      seen.add(item.id);
      if (!text(item.source) || !text(item.description)) add(item, 'requirement-source');
      if (na(item.applicability)) continue;
      if (!list(item.factIds).length || item.factIds.some(id => !byId.has(id))) add(item, 'factIds');
      for (const field of ['content', 'mapping', 'runtime']) if (item[field] !== 'verified' && !na(item[field])) add(item, field, 'pending');
      if (!text(item.evidence)) add(item, 'evidence');
    }
  }
  const unique = [...new Map(issues.map(x => [x.id, x])).values()].sort((a,b) => a.id.localeCompare(b.id));
  return {schemaVersion: '1.0.0', state: unique.length ? 'incomplete' : 'ready', ready: !unique.length, issues: unique, coverage: scopes.length ? 'recorded-not-human-verified' : 'unknown', humanAcceptance: 'not-verified'};
}

export function contentFromProjection({pages = [], interactions = [], assets = [], relations = [], changes = [], figma = []} = {}) {
  const rows = kind => assets.filter(x => x.assetType === kind).map(x => (x.contentFact || {...x, implementationMapping: x.implementationMapping || x.implementationPath}));
  return inspectContentIntegrity({pages:{items:pages}, components:{items:rows('component')}, interactions:{items: interactions.length ? interactions : rows('interaction')}, motions:{items:rows('motion')}, relations:{items:relations}, changes:{items:changes}, 'design-tokens':{items:rows('design-token')}, figma:{items:figma}}, {requireCoverage:true});
}
