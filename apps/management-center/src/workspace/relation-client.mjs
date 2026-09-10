export class RelationRequestError extends Error {
  constructor(message, {status = 0, code = null, currentVersion = null, refreshUrl = null} = {}) {
    super(message);
    this.name = 'RelationRequestError';
    this.status = status;
    this.code = code;
    this.currentVersion = currentVersion;
    this.refreshUrl = refreshUrl;
  }
}

async function responsePayload(response) {
  try { return await response.json(); } catch { return null; }
}

export async function savePageRelation({draft, version, nonce, fetchImpl = fetch, openManager = (url) => globalThis.window?.open?.(url, '_blank', 'noopener')}) {
  const response = await fetchImpl('/__foundation/relations', {method: 'POST', headers: {'content-type': 'application/json', 'x-foundation-write-nonce': nonce}, body: JSON.stringify({...draft, expectedVersion: version || undefined})});
  const payload = await responsePayload(response);
  if (!response.ok) throw new RelationRequestError(payload?.error || `关系保存失败（HTTP ${response.status}）`, {status: response.status, code: payload?.code || null, currentVersion: payload?.currentVersion || null, refreshUrl: payload?.refreshUrl || null});
  if (payload?.state === 'pending-manager-confirmation' && payload?.managerUrl && payload?.sessionId) {
    openManager(payload.managerUrl);
    return payload;
  }
  if (!payload?.relation || !payload?.version) throw new Error('关系保存响应缺少 relation 或 version');
  return payload;
}

export async function loadPageRelations({refreshUrl = '/__foundation/relations/current', fetchImpl = fetch} = {}) {
  const response = await fetchImpl(refreshUrl, {method: 'GET', headers: {'accept': 'application/json'}});
  const payload = await responsePayload(response);
  if (!response.ok) throw new RelationRequestError(payload?.error || `关系刷新失败（HTTP ${response.status}）`, {status: response.status, code: payload?.code || null});
  if (!Array.isArray(payload?.relations) || !payload?.version) throw new RelationRequestError('关系刷新响应缺少 relations 或 version', {status: response.status});
  return {relations: payload.relations, version: payload.version};
}

export async function recoverPageRelationConflict({error, draft}, {load = loadPageRelations, onRefresh = () => {}} = {}) {
  if (!(error instanceof RelationRequestError) || error.status !== 409 || error.code !== 'version_conflict') throw error;
  const latest = await load({refreshUrl: error.refreshUrl || '/__foundation/relations/current'});
  onRefresh(latest);
  return {draft, retryVersion: latest.version, relations: latest.relations};
}

export async function saveRelationWithRollback(options, {save = savePageRelation, onCommit = () => {}, onRollback = () => {}} = {}) {
  try { const payload = await save(options); onCommit(payload); return payload; }
  catch (error) { onRollback(error); throw error; }
}
