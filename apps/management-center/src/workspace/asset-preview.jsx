import {useEffect, useMemo, useRef, useState} from 'react';
import {ContentDescription, ImportantText, MetadataText, SectionTitle} from '@/components/foundation/content-roles';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Button} from '@/components/ui/button';
import {Spinner} from '@/components/ui/spinner';
import {ASSET_PREVIEW_OPAQUE_ORIGIN, ASSET_PREVIEW_SANDBOX, assetPreviewStatusRequest, isAllowedAssetPreviewMessage} from '@/features/preview/asset-preview-policy.mjs';
import {assetPreviewContract,tokenDisplayContract,selectAssetScenario,assetScenarioVariantValues} from './asset-display.mjs';

function channelToken() {
  const bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map((value) => value.toString(36)).join('-') || `preview-${Date.now()}`;
}

function PreviewMessage({title, description, status}) {
  return <div className="asset-preview-state" data-preview-status={status} role="status"><ImportantText as="strong">{title}</ImportantText><ContentDescription as="span">{description}</ContentDescription></div>;
}

function TokenSample({asset,assets}) {
  const token=tokenDisplayContract(asset,assets);
  const [fontState,setFontState]=useState('字体加载待核');
  useEffect(()=>{
    if(token.state!=='sample'||token.type!=='font-family')return;
    let active=true;
    document.fonts.load(`16px ${token.value}`).then(faces=>{if(active)setFontState(faces.length?'已加载登记的字体；字形回退仍需页面核验':'未找到可核验的字体资源，可能使用系统回退');},()=>{if(active)setFontState('字体加载失败，请核对资源');});
    return()=>{active=false;};
  },[token.type,token.value]);
  if(token.state!=='sample')return <PreviewMessage status="missing-context" title="设计变量待核" description={token.reason}/>;
  const property={color:'color',spacing:'width','font-size':'font-size','line-height':'line-height',radius:'border-radius',duration:'animation-duration'}[token.type];
  const valid=token.type==='font-family'||CSS.supports(property,token.value);
  if(!valid)return <PreviewMessage status="error" title="变量值不可用" description="当前浏览器无法解析此值，请核对来源。"/>;
  return <section className="flex flex-col gap-4 p-4" data-token-type={token.type}><SectionTitle>设计变量样例</SectionTitle>{token.type==='color'?<div className="size-16 rounded-md border" style={{backgroundColor:token.value}} aria-label={'色样 '+token.value}/>:token.type==='spacing'?<div className="h-4 bg-primary" style={{width:token.value}} aria-label={'间距 '+token.value}/>:<p className="text-base leading-relaxed" style={{...(['font-family','font-size','line-height'].includes(token.type)?{[{ 'font-family':'fontFamily','font-size':'fontSize','line-height':'lineHeight'}[token.type]]:token.value}:{})}}>产品设计 Aa 0123</p>}<MetadataText>{token.value} · {token.source}</MetadataText>{token.type==='font-family'?<MetadataText role="status">{fontState}</MetadataText>:null}<ContentDescription>样例展示登记值；页面主题与继承环境需另行核验。</ContentDescription></section>;
}

function TokenModes({asset,assets}) {
  const modes=Array.isArray(asset.modeValues)?asset.modeValues:Object.entries(asset.modeValues || {}).map(([name,value])=>({name,value}));
  const [selected,setSelected]=useState('0');
  useEffect(()=>setSelected('0'),[asset.assetId]);
  if(modes.length<2)return <TokenSample asset={asset} assets={assets}/>;
  const items=modes.map((mode,index)=>({value:String(index),label:typeof mode==='object'?(mode.name || mode.mode || `模式 ${index+1}`):`登记值 ${index+1}`}));
  const mode=modes[Number(selected)] ?? modes[0];
  return <section className="flex flex-col gap-4"><Select items={items} value={selected} onValueChange={setSelected}><SelectTrigger aria-label="变量模式"><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select><TokenSample asset={{...asset,value:typeof mode==='object'?mode.value:mode}} assets={assets}/></section>;
}

export function AssetPreview({asset,assets=[],selection=null,onSelectionChange=null}) {
  const projectId=asset?.projectId, revision=asset?.revision;

  const scenarios=asset?.assetModel?.previewScenarios || [];
  const [scenarioId,setScenarioId]=useState('');
  const scenario=selectAssetScenario(asset,selection,scenarioId);
  const contract=assetPreviewContract(asset,{scenario});
  const axes=asset?.assetModel?.variantAxes || [];
  const variantValues=assetScenarioVariantValues(asset,scenario,selection);
  const variantKey=JSON.stringify(variantValues);
  const stateItems=(asset?.assetModel?.states || []).map(value=>({value:value.id,label:value.id}));
  useEffect(()=>{if(!onSelectionChange)return;if(scenario&&selection?.scenarioId!==scenario.id)onSelectionChange({type:'set-scenario',scenarioId:scenario.id,instanceId:scenario.instanceId || null});for(const [key,value]of Object.entries(variantValues))if(selection?.variantValues?.[key]!==value)onSelectionChange({type:'set-variant-value',key,value});},[asset?.assetId,scenario?.id,variantKey,selection?.scenarioId]);
  const [stateName,setStateName]=useState('default');
  useEffect(()=>{setStateName(asset?.assetModel?.states?.[0]?.id || 'default');},[asset?.assetId]);
  const variants = useMemo(() => [...new Set([asset?.variant, ...(asset?.variants || [])].filter(Boolean))], [asset?.assetId, asset?.variant, asset?.variants?.join('|')]);
  const defaultVariant = asset?.variant || variants[0] || 'default';
  const [variant, setVariant] = useState(defaultVariant);
  const activeVariant = variants.includes(variant) ? variant : defaultVariant;
  const [attempt, setAttempt] = useState(0);
  const displayRevision=useMemo(()=>revision,[asset?.resourceRevision || revision,asset?.assetId]);
  const boundRevision=useRef(revision);
  const channel = useMemo(channelToken, [asset?.assetId, activeVariant, asset?.resourceRevision || revision, scenario?.id, stateName, variantKey, attempt]);
  const [previewState, setPreviewState] = useState({assetId: asset?.assetId, variant: activeVariant, channel, status: 'pending', message: ''});
  const iframeRef = useRef(null);
  useEffect(()=>{const previous=boundRevision.current;boundRevision.current=revision;if(previous!==revision)iframeRef.current?.contentWindow?.postMessage({namespace:'ai-product-foundation-asset-preview',kind:'snapshot-rebound',projectId,assetId:asset?.assetId,channel,fromRevision:previous,nextRevision:revision},'*');},[revision,channel]);
  useEffect(() => { setVariant(defaultVariant); }, [asset?.assetId, defaultVariant]);
  useEffect(() => {
    if (contract.status !== 'iframe') return undefined;
    setPreviewState({assetId: asset.assetId, variant: activeVariant, channel, status: 'pending', message: ''});
    const timeout = setTimeout(() => setPreviewState(previous => previous.status === 'pending' ? {...previous, status: 'error', message: '预览未在 10 秒内回执；请检查构建或预览适配器后重试。'} : previous), 10000);
    const onMessage = (event) => {
      if (!isAllowedAssetPreviewMessage(event, {iframeWindow: iframeRef.current?.contentWindow, expectedOrigin: ASSET_PREVIEW_OPAQUE_ORIGIN, assetId: asset?.assetId, channel,projectId,revision})) return;
      const data = event.data;
      setPreviewState({assetId: asset.assetId, variant: activeVariant, channel, status: data.status === 'loading' ? 'pending' : data.status, message: typeof data.message === 'string' ? data.message.slice(0, 300) : ''});
    };
    window.addEventListener('message', onMessage);
    iframeRef.current?.contentWindow?.postMessage(assetPreviewStatusRequest({assetId: asset.assetId, channel,projectId,revision}), '*');
    return () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); };
  }, [asset?.assetId, activeVariant, channel, contract.status,revision]);
  const currentState = previewState.assetId === asset?.assetId && previewState.variant === activeVariant && previewState.channel === channel ? previewState : {status: 'pending', message: ''};
  const status = contract.status === 'iframe' ? currentState.status : contract.status;
  const src = contract.status === 'iframe' ? `${contract.route}?${new URLSearchParams({foundationAssetPreview: '1', assetId: asset.assetId, variant: activeVariant, channel,scenarioId:scenario?.id || asset?.motionScenario || '',instanceId:scenario?.instanceId || selection?.instanceId || '',state:stateName,variantValues:variantKey,...(displayRevision?{projectId,revision:displayRevision}:{})})}` : '';
  const requestStatus = () => iframeRef.current?.contentWindow?.postMessage(assetPreviewStatusRequest({assetId: asset.assetId, channel,projectId,revision}), '*');
  const variantItems = variants.map((value) => ({value, label: value === defaultVariant ? `${value}（默认）` : value}));
  if(contract.status==='page')return <section className="asset-preview"><header><SectionTitle>{asset.name}</SectionTitle><ContentDescription>实际页面 · {contract.route}</ContentDescription></header><div className="asset-preview-viewport"><iframe title={`${asset.name} 实际页面`} src={contract.route} sandbox={ASSET_PREVIEW_SANDBOX}/></div></section>;
  if(contract.status==='token')return <TokenModes asset={asset} assets={assets}/>;
  return <section className="asset-preview" data-preview-status={status}><header><div><SectionTitle>真实资产预览</SectionTitle><ContentDescription>隔离运行已登记实现；交互不会写入 Foundation facts。</ContentDescription></div>{contract.status === 'iframe' && variantItems.length > 1 ? <div className="w-full max-w-48 shrink-0"><Select items={variantItems} value={activeVariant} onValueChange={setVariant}><SelectTrigger className="w-full" aria-label="预览变体"><SelectValue>{variantItems.find((item) => item.value === activeVariant)?.label}</SelectValue></SelectTrigger><SelectContent align="end" alignItemWithTrigger={false}><SelectGroup>{variantItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div> : null}</header>{scenarios.length>0?<div className="flex gap-2 p-4"><Select items={scenarios.map(s=>({value:s.id,label:`${s.kind} · ${s.id}`}))} value={scenario?.id} onValueChange={id=>{setScenarioId(id);onSelectionChange?.({type:'set-scenario',scenarioId:id,instanceId:scenarios.find(s=>s.id===id)?.instanceId || null});}}><SelectTrigger aria-label="预览对象与场景"><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{scenarios.map(s=><SelectItem key={s.id} value={s.id}>{s.kind} · {s.id}</SelectItem>)}</SelectGroup></SelectContent></Select>{asset.assetModel.states?.length?<Select value={stateName} onValueChange={setStateName} items={stateItems}><SelectTrigger aria-label="预览状态"><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{stateItems.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>:null}</div>:null}{axes.map(axis=><div className="px-4 py-2" key={axis.key}><Select items={axis.values.map((value,index)=>({value:String(index),label:String(value)}))} value={String(axis.values.indexOf(variantValues[axis.key]))} onValueChange={index=>onSelectionChange?.({type:'set-variant-value',key:axis.key,value:axis.values[Number(index)]})}><SelectTrigger aria-label={axis.key}><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{axis.values.map((value,index)=><SelectItem key={String(index)} value={String(index)}>{String(value)}</SelectItem>)}</SelectGroup></SelectContent></Select></div>)}{asset?.assetType==='motion'&&contract.status==='iframe'?<Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>重播动效</Button>:null}<div className="asset-preview-viewport" aria-busy={status === 'pending'}>{contract.status === 'iframe' ? <iframe ref={iframeRef} key={src} title={`${asset.name} 真实资产预览`} src={src} sandbox={ASSET_PREVIEW_SANDBOX} onLoad={requestStatus} onError={() => setPreviewState({assetId: asset.assetId, variant: activeVariant, channel, status: 'error', message: '预览资源加载失败，请检查路径后重试。'})} /> : null}{status === 'pending' ? <div className="asset-preview-loading"><Spinner aria-label="正在载入真实组件" /><MetadataText as="span">正在载入真实组件…</MetadataText></div> : null}{['error', 'unsupported'].includes(status) && contract.status === 'iframe' ? <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>重试预览</Button> : null}{status === 'error' ? <PreviewMessage status="error" title="真实组件预览失败" description={currentState.message || '组件运行时返回了渲染错误。'} /> : null}{status === 'unsupported' && contract.status === 'iframe' ? <PreviewMessage status="unsupported" title="当前实现尚未接入预览" description={currentState.message || '实现存在，但还没有安全预览适配器。'} /> : null}{contract.status === 'unsupported' ? <PreviewMessage status="unsupported" title="此类资产暂不提供运行预览" description={contract.reason} /> : null}{contract.status === 'missing-context' ? <PreviewMessage status="missing-context" title="缺少真实预览上下文" description={contract.reason} /> : null}</div></section>;
}
