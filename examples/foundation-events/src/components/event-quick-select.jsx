import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {announceComponent} from '../bridge.mjs';

export function EventQuickSelect({events, value, onValueChange}) {
  return <Select items={events} value={value} onValueChange={(next) => { announceComponent({componentId: 'component_event_quick_select', instanceId: 'event_quick_select_detail', variant: 'detail'}); onValueChange(next); }}><SelectTrigger className="event-select" aria-label="快速选择事件" data-foundation-component-id="component_event_quick_select" data-foundation-instance-id="event_quick_select_detail" data-foundation-variant="detail"><SelectValue>{events.find((event) => event.id === value)?.title || '选择事件'}</SelectValue></SelectTrigger><SelectContent side="bottom" sideOffset={6} align="start" alignItemWithTrigger={false} className="event-select-popup"><SelectGroup>{events.map((event) => <SelectItem className="event-select-item" key={event.id} value={event.id}>{event.title}</SelectItem>)}</SelectGroup></SelectContent></Select>;
}
