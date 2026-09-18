import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {observeProcessFingerprint,classifyProcessOwner} from './process-owner.mjs';
import {inspectLocalLifecycle} from './lifecycle-manager.mjs';
import {synchronizeProject} from './project-sync.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const physical=root=>{const stat=fs.statSync(root);return {dev:String(stat.dev),ino:String(stat.ino)};};
function safe(root,relative,{missing=false}={}) {
  let current=root;
  if(fs.realpathSync(root)!==root)throw new Error('工作台根目录不能包含符号链接');
  for(const part of relative.split('/')) {
    if(!part||part==='.'||part==='..'||part.includes('\\')||part.includes('\0'))throw new Error('工作台状态路径无效');
    current=path.join(current,part);
    try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('工作台状态拒绝符号链接');}catch(error){if(error.code==='ENOENT'&&missing)continue;throw error;}
  }
  return current;
}

export function readWorkbenchAuthorityKey({installationRoot,project=null}) {
  const root=fs.realpathSync(installationRoot);
  if(root!==path.resolve(installationRoot))throw new Error('安装目录身份已变化');
  const current=JSON.parse(fs.readFileSync(safe(root,'state/current.json')));
  const files=['state/current.json','state/projects.json','state/installations.json',`state/receipts/${current.version}.json`,`${current.appPath}/foundation-runtime-descriptor.json`,`bin/${process.platform==='win32'?'foundation-kit.cmd':'foundation-kit'}`];
  const inputs=files.map(name=>{try{return [name,hash(fs.readFileSync(safe(root,name)))]}catch(error){if(name==='state/projects.json'&&error.code==='ENOENT')return [name,null];throw error;}});
  for(const relative of [current.runtimePath,current.entrypoint,`${current.appPath}/artifacts`]){const target=safe(root,relative),stat=fs.statSync(target);inputs.push([relative,{...physical(target),size:stat.size,mode:stat.mode,mtime:stat.mtimeMs,ctime:stat.ctimeMs}]);}
  if(project) {
    if(fs.realpathSync(project)!==project)throw new Error('项目物理路径已变化');
    inputs.push(['project',physical(project)]);
    for(const name of ['.foundation/integration/binding.json','.foundation/identity/project.json'])inputs.push([name,hash(fs.readFileSync(safe(project,name)))]);
  }
  return hash(JSON.stringify([physical(root),inputs]));
}

export function createWorkbenchRuntime({options,initialSnapshot=null,workerUrl=new URL('./workbench-validation-worker.mjs',import.meta.url)}) {
  const eventLoop=monitorEventLoopDelay({resolution:20});eventLoop.enable();
  const generations=new Map();let current=null,flight=null,activeWorker=null,closed=false,lastCheck=0,authorityKey=null,updateFailed=null;
  const counts={fullValidations:0,snapshotBuilds:0,requests:0};
  const budget=128*1024*1024;
  const publishSnapshot=snapshot=>{
    const bytes=Object.values(snapshot.resourceBytes).reduce((n,v)=>n+v.bytes.byteLength,0);
    if(bytes>budget)throw new Error('单代资源超过 128 MiB；保留上一完整版本');
    if(current?.revision===snapshot.revision){authorityKey=snapshot.authorityKey;updateFailed=null;return;}
    const value={...snapshot,resourceBytes:Object.fromEntries(Object.entries(snapshot.resourceBytes).map(([url,entry])=>[url,{...entry,bytes:Buffer.from(entry.bytes)}])),publishedAt:Date.now(),bytes};
    generations.set(value.revision,value);current=value;authorityKey=value.authorityKey;updateFailed=null;
    while(generations.size>2 || [...generations.values()].reduce((n,g)=>n+g.bytes,0)>budget)generations.delete(generations.keys().next().value);
  };
  if(initialSnapshot)publishSnapshot(initialSnapshot);
  const validate=()=>{
    if(closed)return Promise.reject(new Error('工作台已关闭'));
    if(flight)return flight;
    counts.fullValidations++;
    flight=new Promise((resolve,reject)=>{
      const worker=new Worker(workerUrl,{workerData:options});activeWorker=worker;
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('工作台完整校验超时'));},30000);
      worker.once('message',message=>{clearTimeout(timer);worker.terminate();if(message.error)reject(new Error(message.error));else {try{publishSnapshot(message.snapshot);counts.snapshotBuilds++;resolve(current);}catch(error){reject(error);}}});
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error(`工作台校验进程退出：${code}`));});
    }).catch(error=>{updateFailed=error.message;throw error;}).finally(()=>{flight=null;activeWorker=null;lastCheck=Date.now();});
    return flight;
  };
  const interval=setInterval(()=>{validate().catch(()=>{});},1500);interval.unref();
  const inspect=()=>({revision:current?.revision || null,installationGeneration:current?.installationGeneration || null,state:flight?'checking':updateFailed?'updateFailed':current?'ready':'unavailable',updateFailed,lastCheck,eventLoopDelay:{meanMs:eventLoop.mean/1e6,p95Ms:eventLoop.percentile(95)/1e6,maxMs:eventLoop.max/1e6},counts:{...counts}});
  return {validate,inspect,publishSnapshot,
    request({strict=false}={}) {
      counts.requests++;
      const key=readWorkbenchAuthorityKey(options);
      if(authorityKey!==null&&key!==authorityKey){validate().catch(()=>{});throw new Error('安装或项目授权已变化，正在重新核验');}
      if(strict&&(flight||updateFailed))throw new Error(updateFailed || '正在完整核验，暂不可操作');
      if(!current)throw new Error('工作台快照尚未就绪');
      return current;
    },
    generation(revision) {
      for(const [id,snapshot]of generations)if(id!==current?.revision&&Date.now()-snapshot.publishedAt>600000)generations.delete(id);
      return generations.get(revision) || null;
    },
    close(){closed=true;eventLoop.disable();clearInterval(interval);activeWorker?.terminate();},
  };
}

export async function openOrReuseWorkbench({installationRoot,project=null,createServer}) {
  // Validation precedes all writes to the installation-owned instance namespace.
  const state=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
  if(state.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||project&&(state.project?.state!=='enabled'||!state.project?.agreement))throw new Error('工作台安装或项目绑定未通过核验');
  if(project)synchronizeProject({project,installationRoot,trigger:'explicit-open'});
  const root=fs.realpathSync(installationRoot),canonicalProject=project?fs.realpathSync(project):null;
  const key=hash(JSON.stringify([state.installation.current.identity.installId,canonicalProject,canonicalProject?physical(canonicalProject):null,state.project?.projectId || null]));
  const directory=safe(root,'state/workbench-instances',{missing:true});fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const lock=safe(root,`state/workbench-instances/${key}.lock`,{missing:true}),file=safe(root,`state/workbench-instances/${key}.json`,{missing:true});
  const observed=observeProcessFingerprint(process.pid);if(observed.state!=='observed')throw new Error('无法核验工作台进程启动身份');
  const owner={pid:process.pid,processFingerprint:observed.fingerprint,nonce:crypto.randomBytes(24).toString('hex')};
  const start=Date.now();
  for(;;) {
    try{const fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(owner));fs.closeSync(fd);break;}
    catch(error){if(error.code!=='EEXIST')throw error;
      let old;try{old=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{if(Date.now()-start>2000)throw new Error('工作台互斥记录不完整，保留待核');await new Promise(resolve=>setTimeout(resolve,25));continue;}
      const status=classifyProcessOwner(old);
      if(['dead','stale-instance'].includes(status)){if(JSON.stringify(old)===fs.readFileSync(lock,'utf8'))fs.unlinkSync(lock);continue;}
      if(status==='unavailable'||Date.now()-start>30000)throw new Error('工作台打开互斥忙或进程身份未知；未启动重复服务');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  try {
    if(fs.existsSync(file)) {
      const previous=JSON.parse(fs.readFileSync(file,'utf8'));
      if(classifyProcessOwner(previous)==='unavailable')throw new Error('旧实例进程身份未知，保留并停止');
      if(previous.key===key&&classifyProcessOwner(previous)==='live') {
        const url=new URL(previous.url);
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw new Error('实例 URL 无效');
        try {
          const response=await fetch(new URL('/__foundation/instance',url),{headers:{'x-foundation-instance':previous.nonce},signal:AbortSignal.timeout(2000)});
          const handshake=await response.json();
          if(handshake.key===key&&handshake.nonce===previous.nonce&&handshake.pid===previous.pid&&response.ok)return {...previous,reused:true,mutationPerformed:false};
        }catch { /* failed handshake: never kill the process */ }
        throw new Error('已登记进程仍存活但握手未通过；不创建重复实例或终止未知进程');
      }
    }
    const server=await createServer({installationRoot:root,project:canonicalProject});
    const original=server.listeners('request');server.removeAllListeners('request');
    server.on('request',(req,res)=>{
      if(req.url==='/__foundation/instance') {
        if(req.method!=='GET'||req.headers['x-foundation-instance']!==owner.nonce){res.writeHead(403);res.end();return;}
        try{server.foundationRuntime?.request();}catch(error){res.writeHead(503);res.end(JSON.stringify({message:error.message}));return;}
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({key,nonce:owner.nonce,pid:process.pid,generation:server.foundationRuntime?.inspect().installationGeneration || null}));return;
      }
      for(const listener of original)listener.call(server,req,res);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const record={protocolVersion:1,key,...owner,url:`http://127.0.0.1:${server.address().port}/`,generation:readWorkbenchAuthorityKey({installationRoot:root,project:canonicalProject}),surface:'installed-workbench'};
    fs.writeFileSync(file,JSON.stringify(record),{mode:0o600});
    return {...record,reused:false,mutationPerformed:false};
  }finally {if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===JSON.stringify(owner))fs.unlinkSync(lock);}
}
