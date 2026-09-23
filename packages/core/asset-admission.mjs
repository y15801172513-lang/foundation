// Admission consumes current verifier results, never a manually assigned status.
export function assetAdmission(asset,facts,{contentIssues=[]}={}) {
  const reasons=contentIssues.map(issue=>issue.message);
  if(!(asset.assetModel?.responsibility || asset.responsibility || asset.description || asset.summary))reasons.push('需要补充资产用途');
  const component=Boolean(asset.assetModel),token=Boolean(asset.cssVariable || asset.tokenType),motion=Boolean(asset.animationName);
  const ownerIds=component || !token&&!motion?[asset.id]:[...(motion?[asset.id]:[]),...(asset.pageIds || []),...(asset.usageLocations || []).map(usage=>usage.pageId)];
  const evidence=(facts.changes?.items || []).flatMap(change=>change.evidenceIndex || []);
  const results=facts.delivery?.evidenceResults || {};
  const passed=kind=>evidence.some(entry=>{
    const result=results[entry.evidenceId];
    if(!ownerIds.includes(entry.subject?.definitionId)||entry.kind!==kind||result?.state!=='verified'||result.result!=='passed')return false;
    if(kind!=='browser-observation'||!token&&!motion)return true;
    const task=facts.changes.items.find(item=>item.id===entry.taskId);
    const requirement=task?.deliveryScope?.items?.find(item=>item.requirementId===entry.subject?.requirementId);
    if(!requirement?.factIds?.includes(asset.id))return false;
    const modes=Array.isArray(asset.modeValues)?asset.modeValues:Object.values(asset.modeValues || {});
    if(token&&modes.length>1&&!modes.every(mode=>(requirement.browserChecks || []).filter(check=>check.action==='css'&&check.attribute===asset.cssVariable).some(declared=>result.report?.checks?.some(check=>check.id.startsWith(declared.id+'_')&&check.result==='passed'&&check.expected===(typeof mode==='object'?mode.value:mode)))))return false;
    return (requirement.browserChecks || []).some(check=>check.action==='css'&&
      (token?check.attribute===asset.cssVariable&&check.expected===asset.value:check.attribute==='animation-name'&&check.expected===asset.animationName)&&
      result.report?.checks?.some(observed=>observed.id.startsWith(check.id+'_')&&observed.result==='passed'));
  });
  if(!passed('browser-observation'))reasons.push('需要对实际使用页面或独立场景运行验证');
  if(component&&!passed('source-analysis'))reasons.push('需要核验组件定义、参数和真实调用');
  if(token&&!asset.cssVariable)reasons.push('需要明确变量引用名称');
  if((token||motion)&&!ownerIds.length)reasons.push('需要绑定真实使用页面');
  if(asset.synchronization?.state==='pending')reasons.push(asset.synchronization.reason || '源码变化，需要重新同步验证');
  if(!asset.implementationSha256)reasons.push('需要绑定当前实现摘要');
  return {state:reasons.length?'draft':'available',reasons:[...new Set(reasons)],nextStep:reasons.length?'在正常制作同步中补齐上述内容，运行适用验证后重开资产。':null};
}
