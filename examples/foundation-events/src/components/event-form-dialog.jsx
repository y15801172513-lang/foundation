import {useState} from 'react';
import {Plus} from 'lucide-react';
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {Field, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {EventAction} from './event-action';
import {announceComponent} from '../bridge.mjs';

export function EventFormDialog({onCreate}) {
  const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [summary, setSummary] = useState('');
  const submit = (event) => { event.preventDefault(); if (!title.trim() || !summary.trim()) return; announceComponent({componentId: 'component_event_form_dialog', instanceId: 'event_form_create', variant: 'create'}); onCreate({title, summary}); setTitle(''); setSummary(''); setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<EventAction variant="new" instanceId="event_action_new" />}><Plus data-icon="inline-start" />新增事件</DialogTrigger><DialogContent showCloseButton data-foundation-component-id="component_event_form_dialog" data-foundation-instance-id="event_form_create" data-foundation-variant="create"><DialogHeader><DialogTitle>新增事件</DialogTitle><DialogDescription>新增后会进入当前事件列表。</DialogDescription></DialogHeader><form onSubmit={submit} className="event-form"><Field><FieldLabel htmlFor="event-title">标题</FieldLabel><Input id="event-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：验证新的事件关系" /></Field><Field><FieldLabel htmlFor="event-summary">摘要</FieldLabel><Textarea id="event-summary" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="描述这条事件的目标和状态" /></Field><div className="event-form__actions"><DialogClose render={<EventAction variant="manage" instanceId="event_action_cancel" />}>取消</DialogClose><EventAction type="submit" variant="new" instanceId="event_action_create">创建事件</EventAction></div></form></DialogContent></Dialog>;
}
