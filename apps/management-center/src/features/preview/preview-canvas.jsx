import {useState} from 'react';
import {MetadataText} from '@/components/foundation/content-roles';
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@/components/ui/empty';
import {Spinner} from '@/components/ui/spinner';
import {getViewportPreset, VIEWPORT_PRESETS} from '@/state/workspace-state.mjs';
import {PreviewToolbar} from './preview-toolbar';

export function PreviewCanvas({model, state, dispatch, iframeRef, onPreviewLoad}) {
  const [loadedRoute, setLoadedRoute] = useState(null);
  const page = model.pages.find((item) => item.id === state.pageId) || model.pages[0];
  const iframeRoute = state.iframeRoute || page?.route;
  const loading = Boolean(iframeRoute && loadedRoute !== iframeRoute);
  const preset = getViewportPreset(state.viewportPresetId);
  const fixed = preset.type === 'device';
  const frameStyle = fixed ? {width: `${preset.width}px`, height: `${preset.height}px`} : undefined;
  return <section className="preview-workspace"><PreviewToolbar pages={model.pages} page={page} viewportPresetId={state.viewportPresetId} presets={VIEWPORT_PRESETS} dispatch={dispatch} /><div className={fixed ? 'canvas-stage fixed-stage' : 'canvas-stage adaptive-stage'}>{iframeRoute ? <div className={fixed ? 'canvas-frame fixed-frame' : 'canvas-frame adaptive-frame'} style={frameStyle} aria-busy={loading}><iframe ref={iframeRef} id="preview-frame" title="真实产品预览" src={iframeRoute} onLoad={() => { setLoadedRoute(iframeRoute); onPreviewLoad?.(iframeRoute); }} />{loading ? <div className="preview-frame-loading" data-foundation-loading="preview" aria-live="polite"><Spinner className="size-6" aria-label="正在载入产品预览" /><MetadataText as="span">正在载入产品预览…</MetadataText></div> : null}</div> : <Empty><EmptyHeader><EmptyTitle>{model.projectSelected === false ? '尚未选择项目' : '尚未建立预览'}</EmptyTitle><EmptyDescription>{model.projectSelected === false ? '在 Codex 对话中指定要打开的项目目录；接入须单独确认，不会自动扫描或启用项目。' : '请先在项目的 preview 配置中声明页面路由。'}</EmptyDescription></EmptyHeader></Empty>}</div></section>;
}
