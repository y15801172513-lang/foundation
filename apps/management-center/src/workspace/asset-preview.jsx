import {useEffect, useMemo, useRef, useState} from 'react';
import {ContentDescription, ImportantText, MetadataText, SectionTitle} from '@/components/foundation/content-roles';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Spinner} from '@/components/ui/spinner';
import {ASSET_PREVIEW_OPAQUE_ORIGIN, ASSET_PREVIEW_SANDBOX, assetPreviewStatusRequest, isAllowedAssetPreviewMessage} from '@/features/preview/asset-preview-policy.mjs';
import {assetPreviewContract} from './asset-display.mjs';

function channelToken() {
  const bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map((value) => value.toString(36)).join('-') || `preview-${Date.now()}`;
}

function PreviewMessage({title, description, status}) {
  return <div className="asset-preview-state" data-preview-status={status} role="status"><ImportantText as="strong">{title}</ImportantText><ContentDescription as="span">{description}</ContentDescription></div>;
}

export function AssetPreview({asset}) {
  const contract = assetPreviewContract(asset);
  const variants = useMemo(() => [...new Set([asset?.variant, ...(asset?.variants || [])].filter(Boolean))], [asset?.assetId, asset?.variant, asset?.variants?.join('|')]);
  const defaultVariant = asset?.variant || variants[0] || 'default';
  const [variant, setVariant] = useState(defaultVariant);
  const activeVariant = variants.includes(variant) ? variant : defaultVariant;
  const channel = useMemo(channelToken, [asset?.assetId]);
  const [previewState, setPreviewState] = useState({assetId: asset?.assetId, variant: activeVariant, channel, status: 'pending', message: ''});
  const iframeRef = useRef(null);
  useEffect(() => { setVariant(defaultVariant); }, [asset?.assetId, defaultVariant]);
  useEffect(() => {
    if (contract.status !== 'iframe') return undefined;
    setPreviewState({assetId: asset.assetId, variant: activeVariant, channel, status: 'pending', message: ''});
    const onMessage = (event) => {
      if (!isAllowedAssetPreviewMessage(event, {iframeWindow: iframeRef.current?.contentWindow, expectedOrigin: ASSET_PREVIEW_OPAQUE_ORIGIN, assetId: asset?.assetId, channel})) return;
      const data = event.data;
      setPreviewState({assetId: asset.assetId, variant: activeVariant, channel, status: data.status, message: typeof data.message === 'string' ? data.message.slice(0, 300) : ''});
    };
    window.addEventListener('message', onMessage);
    iframeRef.current?.contentWindow?.postMessage(assetPreviewStatusRequest({assetId: asset.assetId, channel}), '*');
    return () => window.removeEventListener('message', onMessage);
  }, [asset?.assetId, activeVariant, channel, contract.status]);
  const currentState = previewState.assetId === asset?.assetId && previewState.variant === activeVariant && previewState.channel === channel ? previewState : {status: 'pending', message: ''};
  const status = contract.status === 'iframe' ? currentState.status : contract.status;
  const src = contract.status === 'iframe' ? `${contract.route}?${new URLSearchParams({foundationAssetPreview: '1', assetId: asset.assetId, variant: activeVariant, channel})}` : '';
  const requestStatus = () => iframeRef.current?.contentWindow?.postMessage(assetPreviewStatusRequest({assetId: asset.assetId, channel}), '*');
  const variantItems = variants.map((value) => ({value, label: value === defaultVariant ? `${value}（默认）` : value}));
  return <section className="asset-preview" data-preview-status={status}><header><div><SectionTitle>真实资产预览</SectionTitle><ContentDescription>隔离运行已登记实现；交互不会写入 Foundation facts。</ContentDescription></div>{contract.status === 'iframe' && variantItems.length > 1 ? <div className="w-full max-w-48 shrink-0"><Select items={variantItems} value={activeVariant} onValueChange={setVariant}><SelectTrigger className="w-full" aria-label="预览变体"><SelectValue>{variantItems.find((item) => item.value === activeVariant)?.label}</SelectValue></SelectTrigger><SelectContent align="end" alignItemWithTrigger={false}><SelectGroup>{variantItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div> : null}</header><div className="asset-preview-viewport" aria-busy={status === 'pending'}>{contract.status === 'iframe' ? <iframe ref={iframeRef} key={src} title={`${asset.name} 真实资产预览`} src={src} sandbox={ASSET_PREVIEW_SANDBOX} onLoad={requestStatus} /> : null}{status === 'pending' ? <div className="asset-preview-loading"><Spinner aria-label="正在载入真实组件" /><MetadataText as="span">正在载入真实组件…</MetadataText></div> : null}{status === 'error' ? <PreviewMessage status="error" title="真实组件预览失败" description={currentState.message || '组件运行时返回了渲染错误。'} /> : null}{status === 'unsupported' && contract.status === 'iframe' ? <PreviewMessage status="unsupported" title="当前实现尚未接入预览" description={currentState.message || '实现存在，但还没有安全预览适配器。'} /> : null}{contract.status === 'unsupported' ? <PreviewMessage status="unsupported" title="此类资产暂不提供运行预览" description={contract.reason} /> : null}{contract.status === 'missing-context' ? <PreviewMessage status="missing-context" title="缺少真实预览上下文" description={contract.reason} /> : null}</div></section>;
}
