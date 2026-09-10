import {MetadataText} from '@/components/foundation/content-roles';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';

export function PreviewToolbar({pages, page, viewportPresetId, presets, dispatch}) {
  const pageItems = pages.map((item) => ({value: item.id, label: item.name}));
  const presetItems = presets.map((item) => ({value: item.id, label: item.label}));
  return (
    <div className="preview-toolbar">
      <MetadataText className="toolbar-label">页面</MetadataText>
      <Select
        items={pageItems}
        value={page?.id || ''}
        onValueChange={(pageId) => {
          const target = pages.find((item) => item.id === pageId);
          dispatch({type: 'navigate-page', pageId, route: target?.route || null});
        }}>
        <SelectTrigger aria-label="当前页面"><SelectValue>{page?.name || '选择页面'}</SelectValue></SelectTrigger>
        <SelectContent align="start" side="bottom" sideOffset={6} alignItemWithTrigger={false}>
          <SelectGroup>{pages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup>
        </SelectContent>
      </Select>
      <MetadataText className="toolbar-label">画布</MetadataText>
      <Select items={presetItems} value={viewportPresetId} onValueChange={(value) => dispatch({type: 'set-viewport', viewportPresetId: value})}>
        <SelectTrigger aria-label="设备尺寸"><SelectValue>{presets.find((item) => item.id === viewportPresetId)?.label || '自适应 Web'}</SelectValue></SelectTrigger>
        <SelectContent align="start" side="bottom" sideOffset={6} alignItemWithTrigger={false}>
          <SelectGroup>{presets.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
