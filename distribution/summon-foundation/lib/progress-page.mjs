import http from 'node:http';
import crypto from 'node:crypto';
import {journeyView} from './journey-view.mjs';

export function downloadText(download) {
  if(!download||!Number.isFinite(download.downloadedBytes)||download.downloadedBytes<0)return '';
  const amount=n=>(n/1048576).toFixed(2)+' MiB';
  const known=Number.isFinite(download.totalBytes)&&download.totalBytes>0;
  return '已接收 '+amount(download.downloadedBytes)+(known?' / '+amount(download.totalBytes)+(download.downloadedBytes<=download.totalBytes?' · '+Math.floor(download.downloadedBytes/download.totalBytes*100)+'%':'（长度待核实）'):'（总量未知）');
}

export function acquisitionProgress(record) {
  const phases={discovering:'查询正式发行','verifying-trust':'核验发行来源','fetching-and-verifying-catalog':'获取并核验发行清单','fetching-and-verifying-runtime':'下载并核验运行文件','extracting-and-validating':'展开并检查文件','acquired':'获取验证完成','starting-confirmation-service':'准备目录选择与确认页','selecting-directory':'等待你选择目录','awaiting-confirmation':'等待你确认安装',executing:'正在安装','runtime-ended':'读取安装结果',finished:'安装结果已返回'};
  const terminal=record.terminal;
  const acquired=['acquired','starting-confirmation-service','selecting-directory','directory-selection-ended','awaiting-confirmation','executing','runtime-ended','finished'].includes(record.phase);
  const observations={acquire:{state:acquired?'completed':terminal?'failed':'running',evidence:record.resultFile}};
  if(record.phase==='selecting-directory')observations.select={state:'pending'};
  if(record.phase==='directory-selection-ended')observations.select={state:record.state==='cancelled-no-install'?'cancelled':record.state==='expired-no-install'?'expired':'verification-required',evidence:record.selectionId};
  if(['awaiting-confirmation','executing','runtime-ended','finished'].includes(record.phase))observations.select={state:'completed',evidence:record.selectionId};
  if(record.phase==='awaiting-confirmation')observations.program={state:'pending',evidence:record.sessionId};
  if(record.phase==='executing')observations.program={state:'running',evidence:record.sessionId};
  if(['runtime-ended','finished'].includes(record.phase))observations.program={state:record.programState||record.state,evidence:record.sessionId};
  if(record.runtimeHealth==='passed')observations.health={state:'completed',evidence:record.sessionId};
  if(record.programState==='completed'){
    observations.acquire={state:'completed',evidence:record.resultFile};
    observations.select={state:'completed',evidence:record.selectionId};
    observations.program={state:'completed',evidence:record.sessionId};
  }
  for(const key of ['material','register'])if(record.skillSteps?.[key])observations[key]=record.skillSteps[key];
  for(const key of ['remove','program'])if(record.maintenanceSteps?.[key])observations[key]=record.maintenanceSteps[key];
  const kind=record.kind||'install';
  const journey=journeyView({id:record.operationId,kind,includeAcquisition:kind!=='uninstall',includeSelection:kind==='install',includeHealth:kind!=='uninstall',includeSkillRemoval:Boolean(observations.remove),observations,skillChoice:record.journeyContext?.skillChoice||'undecided'});
  if(record.terminal&&record.state==='partial'){journey.ended=false;journey.title=record.programState==='completed'?'程序已完成，Codex 接入未完成':'本次操作尚未全部完成';journey.summary=record.next;}
  const verb=kind==='uninstall'?'卸载':kind==='update'?'更新':'安装';
  Object.assign(phases,{'awaiting-confirmation':'等待你确认'+verb,executing:'正在'+verb,'runtime-ended':'读取'+verb+'结果',finished:verb+'结果已返回'});
  if(record.terminal&&record.state==='partial'&&record.programState==='completed'&&kind==='update')journey.title='程序已更新，Skill 尚未更新';
  return {journey,operationId:record.operationId,title:journey.title,phase:({'skill-confirmation':'等待你确认 Codex 操作','skill-executing':'正在处理 Codex 对话能力'})[record.phase]||phases[record.phase]||'正在核实本次操作',state:record.state,version:record.currentVersion&&kind==='update'?record.currentVersion+' → '+record.version:record.version||record.currentVersion||null,download:record.download||null,program:record.programState==='completed'?'程序'+verb+'已完成；'+(kind==='uninstall'?'结果由独立回执保留':record.runtimeHealth==='passed'?'稳定入口健康已核验':'健康待核实'):record.installationWrites==='none'?'尚未执行程序操作':'程序结果以同次记录为准',skill:kind==='uninstall'?(observations.remove?.state==='completed'?'已解除已归属 Codex 注册；修改和未知文件按计划保留':'本次没有已核实的注册移除结果'):record.skillRegistered===true?'Skill 文件与归属已核验；新对话识别另验':record.journeyContext?.skillChoice==='skipped'?'本次不接入 Codex':record.journeyContext?.skillChoice==='selected'?'已选择接入 Codex；仅在分别确认后执行':'Codex 接入可选，尚未选择',project:'未自动接入项目',installationRoot:record.installationRoot||null,skillDestination:record.skillDestination||null,next:record.next||(record.terminal&&record.state==='completed'&&record.journeyContext?.skillChoice==='skipped'?'本次已跳过 Codex 接入；程序操作已完成，项目另行确认。':journey.summary),nextUrl:record.terminal?(kind!=='uninstall'&&record.workbench?.state==='ready'?record.workbench.url:null):record.confirmationUrl||null,nextLabel:record.terminal?'打开已安装工作台':record.phase?.startsWith('skill-')?'查看 Codex 精确确认':kind==='install'?'继续到目录选择 / 本人确认页':'查看'+verb+'确认',resultFile:record.resultFile||null,terminal,diagnostic:record.diagnostic||null};
}

// A bounded, read-only loopback view over the existing in-memory operation.
// No POST, launch endpoint, confirmation authority or downloaded executable.
export async function startProgressPage(readRecord) {
  const token=crypto.randomBytes(24).toString('hex'),base=`/${token}`,clients=new Set();
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Foundation 获取与安装进度</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:24px auto;padding:0 20px;color:#18181b;background:#fafafa;overflow-wrap:anywhere}section{background:white;border:1px solid #e4e4e7;border-radius:12px;padding:16px;margin:16px 0}h1{font-size:24px}h2{font-size:18px}a{display:inline-block;padding:12px;border:1px solid #71717a;border-radius:8px;color:inherit}pre{white-space:pre-wrap}a:focus-visible,summary:focus-visible{outline:3px solid #2563eb}[hidden]{display:none}.steps{display:flex;flex-wrap:wrap;gap:8px}.steps p{margin:0;background:#f4f4f5;padding:6px 10px;border-radius:6px;font-size:13px}header{font-size:14px;font-weight:600}#continue{background:#18181b;color:white;font-weight:600;text-decoration:none}#target{overflow-wrap:anywhere}@media(max-width:480px){body{padding:0 16px}.steps p{flex:1 1 110px}}</style><body><header>Foundation</header><h1>正在准备 Foundation</h1><section role="status" aria-live="polite"><h2 id="phase">正在读取同次操作</h2><div id="journey-steps" class="steps"></div><p id="journey-summary"></p><p id="version"></p><p id="download"></p><p id="target"></p><p id="program"></p><p id="skill"></p><p id="project"></p><p id="next"></p><a id="continue" hidden>继续到目录选择 / 本人确认页</a><p id="connection"></p></section><p>此页面只读，不批准安装；程序、对话能力与项目分别确认。未知长度不显示百分比。临时服务结束后，可从原对话读取保留的操作结果。</p><details><summary>操作与恢复详情</summary><pre id="raw"></pre></details><script>const downloadText=${downloadText.toString()};let last=null;function show(p){last=p;document.querySelector('h1').textContent=p.journey.title;document.getElementById('journey-summary').textContent=p.journey.summary;const steps=document.getElementById('journey-steps');steps.replaceChildren();for(const step of p.journey.steps){const line=document.createElement('p');line.textContent=step.title+'：'+step.label;steps.append(line);}for(const key of ['phase','program','skill','project','next'])document.getElementById(key).textContent=p[key]||'';document.getElementById('download').textContent=downloadText(p.download);document.getElementById('version').textContent=p.version?'版本：'+p.version:'';document.getElementById('target').textContent=p.installationRoot?'程序目录：'+p.installationRoot:'';const link=document.getElementById('continue');link.hidden=!p.nextUrl;link.textContent=p.nextLabel;if(p.nextUrl)link.href=p.nextUrl;document.getElementById('raw').textContent=JSON.stringify(p,null,2);}const events=new EventSource(location.pathname+'/events');events.onmessage=e=>show(JSON.parse(e.data));events.onerror=()=>{events.close();document.getElementById('connection').textContent=last&&last.terminal?'临时进度服务已结束，上方保留最后收到的结果。':'连接已中断，当前状态待核实；不自动重试安装。'};window.addEventListener('pagehide',()=>events.close(),{once:true});</script></body></html>`;
  let origin;
  const current=()=>JSON.stringify(acquisitionProgress(readRecord()));
  const server=http.createServer((req,res)=>{
    if(req.method!=='GET'||req.headers.host!==origin||req.headers.origin&&req.headers.origin!==`http://${origin}`){res.writeHead(403).end();return;}
    const headers={'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    if(req.url===base){res.writeHead(200,{...headers,'content-type':'text/html; charset=utf-8'}).end(html);}
    else if(req.url===base+'/events'){res.writeHead(200,{...headers,'content-type':'text/event-stream'});res.write(`data: ${current()}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));}
    else{res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`127.0.0.1:${server.address().port}`;
  return {url:`http://${origin}${base}`,publish(){for(const res of clients)res.write(`data: ${current()}\n\n`);},close(){for(const res of clients)res.end();clients.clear();return new Promise(resolve=>server.close(resolve));}};
}
