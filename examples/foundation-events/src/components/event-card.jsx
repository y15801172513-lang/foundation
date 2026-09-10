import {ArrowUpRight, Star} from 'lucide-react';
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {eventCardInstanceId} from '@foundation/core/identity';
import {announceComponent} from '../bridge.mjs';

export function EventCard({event, pageId, variant, onOpen, children}) {
  const instanceId = eventCardInstanceId(pageId, event.id);
  const open = () => { announceComponent({componentId: 'component_event_card', instanceId, variant, pageId, eventId: event.id, eventState: event.status}); onOpen(); };
  const label = variant === 'featured' ? '重要事件' : event.status === 'current' ? '当前事件' : event.status === 'archived' ? '已归档' : '已删除';
  return <Card className={`event-card event-card--${variant}`} data-foundation-component-id="component_event_card" data-foundation-instance-id={instanceId} data-foundation-variant={variant} data-foundation-event-id={event.id} data-foundation-event-state={event.status} data-foundation-label={event.title}><CardHeader className="event-card__header"><Badge variant="outline" className="eyebrow">{label}</Badge>{event.important && <Star aria-label="重要" data-icon="inline-end" />}</CardHeader><CardContent><CardTitle>{event.title}</CardTitle><p>{event.summary}</p>{variant === 'featured' && event.nextAction && <span className="event-card__next-action"><strong>下一步</strong>{event.nextAction}</span>}<span className="event-card__footer"><time>{new Date(event.updatedAt).toLocaleString('zh-CN', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</time><ArrowUpRight aria-hidden="true" /></span></CardContent><Button variant="ghost" className="event-card__open" aria-label={`查看事件：${event.title}`} onClick={open}><span className="sr-only">查看事件</span></Button>{children && <CardFooter className="event-card__actions">{children}</CardFooter>}</Card>;
}
