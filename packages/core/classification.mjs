export const CLASSES = ['same_instance', 'variant', 'base_update', 'new_component', 'local_exception', 'needs_user_decision'];

export function classify(input) {
  let label = 'needs_user_decision';
  let reason = '证据不足或产品意图不清';
  let confidence = 'low';
  if (input.changeType === 'copy_or_data') [label, reason, confidence] = ['same_instance', '只改变使用内容，结构和用途不变', 'high'];
  else if (input.changeType === 'repeatable_style_or_state' && input.samePurpose && input.sameStructure) [label, reason, confidence] = ['variant', '同用途同主结构，差异可重复为正式变体', 'high'];
  else if (input.applyToAll === true) [label, reason, confidence] = ['base_update', '明确要求所有使用位置共同改变', 'high'];
  else if (input.structuralChange === 'fundamental' || input.interactionOutcome === 'different' || input.accessibility === 'different') [label, reason, confidence] = ['new_component', '用途、主结构、交互结果或可访问行为根本改变', 'high'];
  else if (input.singleLocation === true && input.explicitSpecialHandling === true) [label, reason, confidence] = ['local_exception', '单个使用位置有明确特殊处理', 'high'];
  return {label, reason, evidence: input, confidence, affectedPages: input.affectedPages || []};
}
