import {announceComponent} from '../bridge.mjs';
import {Badge} from '@/components/ui/badge';
import {eventStatusInstanceId} from '@foundation/core/identity';

const labels = {current: '当前', archived: '已归档', deleted: '已删除'};

export function EventStatus({status, eventId, pageId = 'page_event_detail'}) {
  const select = () => announceComponent({componentId: 'component_event_status_badge', instanceId: eventStatusInstanceId(pageId, eventId, status), variant: status, pageId, eventId, eventState: status});
  return <Badge variant={status === 'deleted' ? 'destructive' : status === 'archived' ? 'secondary' : 'outline'} className={`event-status event-status--${status}`} data-foundation-component-id="component_event_status_badge" data-foundation-instance-id={eventStatusInstanceId(pageId, eventId, status)} data-foundation-variant={status} data-foundation-event-id={eventId} data-foundation-event-state={status} role="button" tabIndex={0} aria-label={`选择事件状态：${labels[status] || '未知'}`} onClick={select} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }}>状态：{labels[status] || '未知'}</Badge>;
}
