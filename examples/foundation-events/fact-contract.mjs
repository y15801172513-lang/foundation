import {validEventStatusIdentity} from '../../packages/core/identity.mjs';

// This example owns its event identity convention; generic Facts do not.
export function validateEventFacts(facts) {
  const errors = [];
  for (const component of facts.components?.items || []) {
    if (component.id !== 'component_event_status_badge') continue;
    for (const [index, usage] of (component.usageLocations || []).entries()) {
      if (!validEventStatusIdentity({pageId: usage.pageId, eventId: usage.eventId, status: usage.variant, instanceId: usage.instanceId})) {
        errors.push(`EventStatus usageLocations[${index}] 页面/事件/状态身份不一致：${usage.instanceId}`);
      }
    }
  }
  return errors;
}
