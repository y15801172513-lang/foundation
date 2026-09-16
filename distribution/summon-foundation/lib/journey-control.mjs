import crypto from 'node:crypto';

// Only the exact child created by this invocation may supply an active view.
// Browser input cannot name a URL, route, transport token or future plan.
export function createJourneyControl(readRecord, changed) {
  const children=new Map();let active=null,origin=null,choice=null,resolveChoice,rejectChoice,choiceTimer,viewRevision=0;
  const headers=owner=>({origin,'content-type':'application/json','x-foundation-journey':owner.token,'x-foundation-operation':readRecord().operationId});
  const request=async(owner,route,body)=>{
    if(owner.child.exitCode!==null||owner.child.signalCode)throw Error('确认服务已退出，结果待核实');
    const response=await fetch(owner.url+route,{method:body?'POST':'GET',headers:headers(owner),...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(120000)});
    return {status:response.status,body:await response.json()};
  };
  return {
    setOrigin(value){if(origin)throw Error('单页来源不能重绑定');origin=value;},
    attach(child){
      const owner={child,token:crypto.randomBytes(32).toString('hex'),url:null};children.set(child,owner);
      child.on('message',message=>{if(message?.type==='foundation-journey-ready-v1')child.send({type:'foundation-journey-bind-v1',origin,operationId:readRecord().operationId,token:owner.token});});
      child.once('close',()=>{children.delete(child);if(active?.owner===owner){active=null;changed();}});
    },
    async observe(child,event){
      if(event.status==='FOUNDATION_OPERATION_STATE'&&active?.view?.session?.sessionId===event.sessionId){active.view.session.state=event.state;changed();return;}
      if(!['AWAITING_FOUNDATION_DIRECTORY_SELECTION','AWAITING_FOUNDATION_UI_CONFIRMATION'].includes(event.status))return;
      const owner=children.get(child);if(!owner)throw Error('未绑定的确认进程');
      const revision=++viewRevision;
      const url=new URL(event.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('确认服务地址无效');
      owner.url=url.href;
      const selection=event.status==='AWAITING_FOUNDATION_DIRECTORY_SELECTION';
      const result=await request(owner,selection?'__foundation/install/view':'__foundation/manager/view');
      if(children.get(child)!==owner||revision!==viewRevision)return;
      if(result.status!==200||result.body.operationId!==readRecord().operationId)throw Error('当前引擎不支持单页确认；旧版本需要另行重新安装，不降级到旧页面');
      if(!selection&&result.body.session.sessionId!==event.sessionId)throw Error('确认会话不匹配');
      active={owner,type:selection?'selection':'manager',view:result.body};changed();
      if(selection&&choice){
        const selected=await request(owner,'__foundation/install/selection',{nonce:result.body.nonce,action:'select',destination:choice.destination,skillChoice:choice.skillChoice});
        if(selected.status!==200){active.error=selected.body.message;choice=null;changed();}
      }
    },
    view(){return active?{type:active.type,...active.view,error:active.error||null}:null;},
    waitChoice({timeoutMs=600000}={}){return new Promise((resolve,reject)=>{
      if(resolveChoice)throw Error('目录选择已在等待');
      resolveChoice=resolve;rejectChoice=reject;
      choiceTimer=setTimeout(()=>{resolveChoice=null;rejectChoice=null;reject(Object.assign(Error('目录选择已到期，尚未下载或安装；重新发起需要新的选择'),{code:'ENTRY_CHOICE_EXPIRED'}));changed();},timeoutMs);
      changed();
    });},
    async submit(body){
      if(body.operationId!==readRecord().operationId)throw Error('流程身份不匹配');
      if(body.action==='cancel-intent'&&rejectChoice){
        clearTimeout(choiceTimer);const reject=rejectChoice;resolveChoice=null;rejectChoice=null;
        reject(Object.assign(Error('已取消目录选择，尚未下载或安装'),{code:'ENTRY_CHOICE_CANCELLED'}));changed();return {status:200,body:{state:'cancelled-no-install'}};
      }
      if(body.action==='choose'&&resolveChoice){
        if(typeof body.destination!=='string'||!body.destination.trim()||!['selected','skipped'].includes(body.skillChoice))throw Error('请选择完整目录和 Skill 意向');
        choice={destination:body.destination,skillChoice:body.skillChoice};const resolve=resolveChoice;clearTimeout(choiceTimer);resolveChoice=null;rejectChoice=null;resolve(choice);changed();return {status:200,body:{state:'intent-selected'}};
      }
      if(!active)throw Error('当前没有可确认的计划；请等待或查询结果');
      const a=active;
      if(a.type==='selection'){
        if(!['select','cancel'].includes(body.action))throw Error('目录操作无效');
        const result=await request(a.owner,'__foundation/install/selection',{nonce:a.view.nonce,action:body.action,destination:body.destination,skillChoice:body.skillChoice});
        if(result.status!==200)a.error=result.body.message;changed();return result;
      }
      const s=a.view.session;
      if(body.sessionId!==s.sessionId||body.planHash!==s.planHash||body.managerNonce!==a.view.managerNonce||!['cancel-no-change',a.view.action].includes(body.action))throw Error('当前计划已变化或请求无效');
      const result=await request(a.owner,'__foundation/manager/confirm',{operationId:body.operationId,sessionId:s.sessionId,planHash:s.planHash,managerNonce:body.managerNonce,action:body.action});
      if(active===a&&result.body.state)a.view.session={...s,...result.body};changed();return result;
    }
  };
}
