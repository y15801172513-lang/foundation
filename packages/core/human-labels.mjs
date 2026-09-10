const LABELS = {
  assetType: {page: '页面', 'page-local': '页面局部资产', component: '组件', interaction: '交互逻辑', motion: '动效', 'design-token': '设计变量（颜色、间距等）'},
  scope: {project: '项目', page: '页面', component: '组件', asset: '资产', 'page-local': '页面局部资产'},
  status: {registered: '已登记（不代表已实现或验证）', confirmed: '已确认', pending: '待确认', verified: '已验证', unverified: '未验证', conflict: '存在冲突', missing: '缺失登记', unknown: '尚未登记'},
  verification: {verified: '已验证', unverified: '未验证', pending: '待确认', missing: '缺失登记', unknown: '尚未登记'},
  figma: {mapped: '已映射', unmapped: '未映射', '未映射': '未映射', verified: '已验证', unverified: '未验证', pending: '待确认', unknown: '尚未登记'}
};

const UNKNOWN = {assetType: '未知类型', scope: '未知范围', status: '未知状态', verification: '未知验证状态', figma: '未知映射状态'};

export function humanLabel(kind, value) {
  if (value === null || value === undefined || value === '') return '尚未登记';
  const raw = String(value);
  return LABELS[kind]?.[raw] || `${UNKNOWN[kind] || '未知值'}（${raw}）`;
}
