import {ContentDescription, MetadataText, SectionTitle} from './content-roles';

const labels={scope:'需求范围',content:'内容完整',definition:'组件定义',runtime:'实际运行',layout:'布局'};
const states={passed:'通过',failed:'失败',pending:'待核',blocked:'受阻','not-applicable':'不适用'};
export function DeliveryAssessment({assessment}) {
  return <section className="flex flex-col gap-2 py-3" data-delivery-assessment={assessment?.aggregate || 'pending'}><SectionTitle>交付验收 · {states[assessment?.aggregate] || '待核'}</SectionTitle><ContentDescription>{Object.entries(labels).map(([key,label])=>`${label}：${states[assessment?.[key]?.state] || '待核'}`).join(' · ')}</ContentDescription>{assessment?.issues?.slice(0,3).map(issue=><MetadataText key={issue.id || issue.message}>{issue.message}</MetadataText>)}<MetadataText>内容一致和资料已更新不等于验收通过。</MetadataText></section>;
}
