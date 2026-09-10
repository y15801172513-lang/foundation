import {useState} from 'react';
import {Copy} from 'lucide-react';
import {ContentDescription, PanelTitle, SectionTitle} from '@/components/foundation/content-roles';
import {Button} from '@/components/ui/button';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Textarea} from '@/components/ui/textarea';
import {contextHumanView} from '@foundation/core/context';

function HumanSection({section}) {
  const content = <div className="human-section-content"><SectionTitle>{section.title}</SectionTitle><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
  return <section className={section.id === 'technical' ? 'human-section human-technical' : 'human-section'}>{content}</section>;
}

export function ContextDataView({record, rawText, onCopy, scopeLabel, excludeSectionIds = [], tabsVariant = 'line'}) {
  const [view, setView] = useState('human');
  const human = contextHumanView(record);
  const excluded = new Set(excludeSectionIds);
  return <Tabs value={view} onValueChange={setView} className="context-data-view"><TabsList variant={tabsVariant} aria-label={`${scopeLabel}显示方式`}><TabsTrigger value="human">白话说明</TabsTrigger><TabsTrigger value="raw">原始数据</TabsTrigger></TabsList><TabsContent value="human" className="context-view-content"><section className="human-intro"><PanelTitle>{human.identity.title}</PanelTitle><ContentDescription>{human.identity.summary}</ContentDescription></section>{human.sections.filter((section) => !excluded.has(section.id)).map((section) => <HumanSection key={section.id} section={section} />)}<Button onClick={onCopy}><Copy data-icon="inline-start" />复制给 Codex</Button></TabsContent><TabsContent value="raw" className="context-view-content"><ContentDescription className="raw-view-hint">以下为完整规范化原文；复制内容与此处逐字节一致。</ContentDescription><Textarea aria-label={`${scopeLabel}原始数据`} className="context-raw-text" readOnly value={rawText} /><Button onClick={onCopy}><Copy data-icon="inline-start" />复制给 Codex</Button></TabsContent></Tabs>;
}
