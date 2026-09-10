import {Button} from '@/components/ui/button';
import {announceComponent} from '../bridge.mjs';

export function EventAction({variant, instanceId, eventId = null, eventState = null, targetEventState = null, children, className = '', onClick, ...props}) {
  const uiVariant = variant === 'delete' ? 'destructive' : variant === 'manage' || variant === 'restore' || variant === 'back' ? 'outline' : 'default';
  return <Button variant={uiVariant} className={`event-action event-action--${variant} ${className}`} data-foundation-component-id="component_event_action" data-foundation-instance-id={instanceId} data-foundation-variant={variant} data-foundation-event-id={eventId || undefined} data-foundation-event-state={targetEventState || eventState || undefined} onClick={(event) => { announceComponent({componentId: 'component_event_action', instanceId, variant, eventId, eventState: targetEventState || eventState}); onClick?.(event); }} {...props}>{children}</Button>;
}
