// Derive applicable verifier requests from the current task's explicit scope.
// Reports still enter facts through the existing exact, source-bound batch.
export function deliveryVerificationPlan(facts,taskId) {
 const task=facts.changes.items.find(item=>item.id===taskId);
 if(!task?.deliveryScope?.items?.length)throw new Error('交付验证需要当前任务的明确范围');
 const requests=[],pending=[];
 for(const requirement of task.deliveryScope.items) {
  if(requirement.applicability?.state==='not-applicable')continue;
  const owners=[...facts.pages.items,...facts.components.items].filter(asset=>requirement.factIds.includes(asset.id));
  if(!owners.length)owners.push(...(facts.motions?.items || []).filter(asset=>requirement.factIds.includes(asset.id)));
  if(!owners.length){pending.push({requirementId:requirement.requirementId,reason:'验证范围缺少实际页面或组件使用点'});continue;}
  for(const asset of owners) {
   const base={taskId,assetId:asset.id,requirementId:requirement.requirementId};
   if(asset.assetModel||requirement.requiredEvidenceDimensions?.includes('definition'))requests.push({...base,kind:'definition',entryRoots:[...new Set([asset.implementationMapping,...(asset.assetModel?.implementationInputs || asset.previewBinding?.inputs?.map(input=>({to:input.path})) || []).map(input=>input.to)].filter(file=>/\.[cm]?[jt]sx?$/u.test(file)&&!file.startsWith('dist/')))]});
   if(!requirement.browserChecks?.length){pending.push({...base,reason:'缺少与需求对应的浏览器断言'});continue;}
   const scenarios=asset.assetModel?asset.assetModel.previewScenarios || []:[{id:asset.animationName?'motion':'page'}];
   if(!scenarios.length)pending.push({...base,reason:'缺少可运行的真实场景'});
   for(const scenario of scenarios)requests.push({...base,kind:'browser',scenarioId:scenario.id});
  }
 }
 return {schemaVersion:'foundation-delivery-verification/1',taskId,scopeRevision:task.deliveryScope.revision,requests,pending,mutationPerformed:false};
}
