import {Info} from 'lucide-react';
import {ContentDescription, SectionTitle} from '@/components/foundation/content-roles';
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from '@/components/ui/empty';
import {ScrollArea} from '@/components/ui/scroll-area';
import {TabsContent} from '@/components/ui/tabs';
import {ContextDataView} from './context-data-view';

export function ContextContent({model, state, page, component, pageContextRecord, componentContextRecord, pageContext, componentContext, onCopyPage, onCopyComponent}) {
  const relationCount = model.relations.filter((item) => item.from === page?.id || item.to === page?.id).length;
  const PanelContentContainer = state.panelPlacement === 'floating' ? 'div' : ScrollArea;
  const panelScrollClass = state.panelPlacement === 'floating' ? 'panel-scroll panel-scroll-static' : 'panel-scroll';
  return <PanelContentContainer className={panelScrollClass}><TabsContent value="page" className="panel-content"><ContextDataView record={pageContextRecord} rawText={pageContext} onCopy={onCopyPage} scopeLabel="当前页面" /></TabsContent><TabsContent value="component" className="panel-content">{component ? <ContextDataView record={componentContextRecord} rawText={componentContext} onCopy={onCopyComponent} scopeLabel="当前组件" /> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Info /></EmptyMedia><EmptyTitle>暂无组件选择</EmptyTitle><EmptyDescription>在产品预览中选择组件后，这里会显示可复用信息。</EmptyDescription></EmptyHeader></Empty>}</TabsContent><TabsContent value="relations" className="panel-content"><section className="panel-section"><SectionTitle as="h2">关系与逻辑</SectionTitle><ContentDescription className="panel-route">{relationCount} 条与当前页面相关的关系</ContentDescription><div className="stack">{model.relations.map((item) => <div className="relation-row" key={`${item.from}-${item.to}`}><span>{item.fromName}</span><span aria-hidden="true">→</span><span>{item.toName}</span></div>)}</div></section></TabsContent><TabsContent value="changes" className="panel-content"><section className="panel-section"><SectionTitle as="h2">变化与影响</SectionTitle><ContentDescription className="panel-route">当前事实库记录的变更</ContentDescription>{model.changes.length ? <div className="stack">{model.changes.map((item) => <ContentDescription key={item.id}>{item.summary || item.description || '已记录变化'}</ContentDescription>)}</div> : <Empty><EmptyHeader><EmptyTitle>暂无变化记录</EmptyTitle></EmptyHeader></Empty>}</section></TabsContent></PanelContentContainer>;
}
