import {spawnSync} from 'node:child_process';
import policy from './public-policy.json' with {type:'json'};

const origin='https://api.github.com',prefix=`/repos/${policy.repository}`;
const allowed=url=>url.origin===origin&&(url.pathname===prefix||url.pathname.startsWith(prefix+'/'));
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function error(code,message,diagnostic,retryable=false){return Object.assign(Error(message),{code,stage:'discovering',diagnostic,retryable});}
function parseResponse(bytes){
  let data=Buffer.from(bytes||'');
  for(let count=0;count<8;count++){
    const end=data.indexOf('\r\n\r\n');if(end<0||end>65536)break;
    const lines=data.subarray(0,end).toString('latin1').split('\r\n'),match=/^HTTP\/\S+ (\d{3})(?: |$)/.exec(lines.shift());if(!match)break;
    const headers={};for(const line of lines){const colon=line.indexOf(':');if(colon>0)headers[line.slice(0,colon).toLowerCase()]=line.slice(colon+1).trim();}
    data=data.subarray(end+4);const status=Number(match[1]);if(status>=100&&status<200)continue;
    return {status,headers,body:data};
  }
  throw error('GITHUB_API_RESPONSE_INVALID','GitHub API 响应格式无效；未执行安装。',{category:'http'});
}
function waitSeconds(headers,now){
  const values=[];
  if(headers['retry-after']!==undefined){const raw=headers['retry-after'];const seconds=/^\d+$/.test(raw)?Number(raw):(Date.parse(raw)-now)/1000;if(Number.isFinite(seconds))values.push(Math.max(0,Math.ceil(seconds)));}
  if(headers['x-ratelimit-remaining']==='0'&&/^\d+$/.test(headers['x-ratelimit-reset']||'')){const reset=Number(headers['x-ratelimit-reset']);if(Number.isSafeInteger(reset))values.push(Math.max(0,Math.ceil(reset-now/1000)));}
  return values.length?Math.max(...values):60;
}
// No curl redirect following: every hop is checked before starting a process.
// Authorization is piped on stdin, never included in argv, env or a header file.
export function githubApi(endpoint,auth={source:'anonymous',token:null},{run=spawnSync,env=process.env,now=Date.now,wait=sleep}={}) {
  let url=new URL(prefix+(endpoint?'/'+endpoint:''),origin),credentialEligible=true,redirects=0,retries=0,waited=0;
  const deadline=now()+120000;
  if(!allowed(url))throw error('GITHUB_API_URL_INVALID','GitHub API 路径越界。',{category:'http'});
  const childEnv={PATH:'/usr/bin:/bin'};
  for(const key of ['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','TMPDIR'])if(env[key])childEnv[key]=env[key];
  while(true){
    const remaining=Math.ceil((deadline-now())/1000);
    if(remaining<=0)throw error('ACQUISITION_TRANSPORT_FAILED',`GitHub API 请求超时（认证来源 ${auth.source}）；检查网络后重新获取。`,{source:auth.source,host:'api.github.com',category:'timeout-or-low-speed',curlExitCode:28},true);
    if(url.protocol!=='https:'||url.username||url.password||url.port||auth.token&&url.href.includes(auth.token))throw error('GITHUB_API_REDIRECT_REJECTED','拒绝不安全的 GitHub API 重定向。',{category:'http',source:auth.source});
    const attach=credentialEligible&&allowed(url)&&auth.token;
    if(attach&&!/^[\x21-\x7e]{1,8192}$/.test(auth.token))throw error('GITHUB_AUTH_INVALID','GitHub 凭证格式无效。',{category:'authentication',source:auth.source});
    const input='Accept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\n'+(attach?`Authorization: Bearer ${auth.token}\n`:'');
    const result=run('/usr/bin/curl',['-q','--silent','--show-error','--include','--suppress-connect-headers','--proto','=https','--connect-timeout','15','--max-time',String(remaining),'--header','@-',url.href],{input,env:childEnv,maxBuffer:10_065_536,timeout:remaining*1000+5000});
    const source=auth.source,diagnostic={source,host:'api.github.com'};
    if(result.status!==0||result.error){const category=({5:'proxy-dns',6:'dns',7:'connection',28:'timeout-or-low-speed',35:'tls',60:'tls-certificate'})[result.status]||'transport';throw error('ACQUISITION_TRANSPORT_FAILED',`GitHub API 网络失败（认证来源 ${source}，${category}）；检查网络或代理后重新获取。`,{...diagnostic,category,curlExitCode:Number.isInteger(result.status)?result.status:null},true);}
    const {status,headers,body}=parseResponse(result.stdout);
    if([301,302,303,307,308].includes(status)){
      if(!headers.location||redirects++>=4)throw error('GITHUB_API_REDIRECT_REJECTED','GitHub API 重定向缺失或次数超限。',{...diagnostic,category:'http',httpStatus:status});
      let next;try{next=new URL(headers.location,url);}catch{throw error('GITHUB_API_REDIRECT_REJECTED','GitHub API 重定向地址无效。',{...diagnostic,category:'http'});}
      credentialEligible=credentialEligible&&allowed(next);url=next;continue;
    }
    if(status>=200&&status<300){try{return JSON.parse(body.toString('utf8'));}catch{throw error('GITHUB_API_RESPONSE_INVALID','GitHub API 返回的 JSON 无效。',{...diagnostic,category:'http',httpStatus:status});}}
    if(status===401)throw error('GITHUB_AUTH_REJECTED',`GitHub 拒绝认证（来源 ${source}）；请更新该来源的凭证${source==='gh'?'，自行运行 gh auth login --hostname github.com':''}，不会自动改用匿名。`,{...diagnostic,category:'authentication',httpStatus:status});
    const primary=[403,429].includes(status)&&headers['x-ratelimit-remaining']==='0';
    const secondary=status===429||status===403&&(headers['retry-after']!==undefined||/secondary rate limit|abuse detection/i.test(body.toString('utf8')));
    if(primary||secondary){
      const seconds=waitSeconds(headers,now()),category=primary?'primary-rate-limit':'secondary-rate-limit';
      // At most two retries and five seconds of total waiting. A longer server
      // deadline is reported, never shortened into a premature retry.
      if(retries<2&&seconds<=5-waited){retries++;waited+=seconds;wait(seconds*1000);continue;}
      throw error(primary?'GITHUB_PRIMARY_RATE_LIMIT':'GITHUB_SECONDARY_RATE_LIMIT',`GitHub ${primary?'主':'次级'}限流（认证来源 ${source}）；至少等待 ${seconds} 秒后再获取。${source==='anonymous'?'可显式选择 --github-auth gh 复用已有登录。':''}`,{...diagnostic,category,httpStatus:status,retryAfterSeconds:seconds},true);
    }
    if(status===403)throw error('GITHUB_API_FORBIDDEN',`GitHub API 权限不足（认证来源 ${source}）；核实凭证权限或组织策略，不自动重试或回退匿名。`,{...diagnostic,category:'forbidden',httpStatus:status});
    throw error('GITHUB_API_HTTP_FAILED',`GitHub API 返回 HTTP ${status}（认证来源 ${source}）；核实所选发行与服务状态后重试。`,{...diagnostic,category:'http',httpStatus:status},status>=500);
  }
}
