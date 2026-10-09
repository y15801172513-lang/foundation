import {spawnSync} from 'node:child_process';

const credentialKeys=['GH_TOKEN','GITHUB_TOKEN'];
export function withoutGitHubCredentials(env=process.env) {
  const result={...env};for(const key of credentialKeys)delete result[key];return result;
}
export function takeGitHubCredentials(env=process.env) {
  const result={};for(const key of credentialKeys){result[key]=env[key];delete env[key];}return result;
}
function failure(code,message,source){return Object.assign(Error(message),{code,stage:'discovering',retryable:false,diagnostic:{category:'authentication',source}});}
export function resolveGitHubAuth(mode='auto',credentials=process.env,{run=spawnSync,env=process.env}={}) {
  if(!['auto','anonymous','gh'].includes(mode))throw failure('GITHUB_AUTH_MODE_INVALID','--github-auth 仅支持 auto、anonymous 或 gh','none');
  if(mode==='anonymous')return {source:'anonymous',token:null};
  let source='anonymous',token=null;
  if(mode==='gh'){
    source='gh';const childEnv={GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1'};
    for(const key of ['PATH','HOME','XDG_CONFIG_HOME','GH_CONFIG_DIR','TMPDIR'])if(env[key])childEnv[key]=env[key];
    const result=run('gh',['auth','token','--hostname','github.com'],{env:childEnv,encoding:'utf8',timeout:10000,maxBuffer:16384});
    if(result.error?.code==='ENOENT')throw failure('GITHUB_AUTH_GH_UNAVAILABLE','未找到 gh；请安装 GitHub CLI 后自行登录，或选择 --github-auth anonymous。','gh');
    if(result.error?.code==='ETIMEDOUT'||result.signal)throw failure('GITHUB_AUTH_GH_TIMEOUT','读取 gh 登录超时；请自行检查 gh auth status --hostname github.com 后重试。','gh');
    if(result.status!==0||result.error)throw failure('GITHUB_AUTH_GH_NOT_LOGGED_IN','无法读取 gh 登录；请自行运行 gh auth login --hostname github.com 后重试。','gh');
    token=String(result.stdout||'').trim();
    if(!token)throw failure('GITHUB_AUTH_GH_NOT_LOGGED_IN','gh 没有可用登录；请自行运行 gh auth login --hostname github.com。','gh');
  }else{
    for(const key of credentialKeys)if(credentials[key]){source=key;token=credentials[key];break;}
  }
  if(token!==null&&(typeof token!=='string'||token.length>8192||!/^[\x21-\x7e]+$/.test(token)))throw failure('GITHUB_AUTH_INVALID','GitHub 凭证格式无效；请修正所选认证来源，或明确选择 --github-auth anonymous。',source);
  return {source,token};
}

export function redactGitHubSecret(message,auth) {
  let text=String(message);if(auth?.token)text=text.split(auth.token).join('[已脱敏凭据]');
  return text.replace(/https?:\/\/\S+/g,'[已脱敏网址]').replace(/(?:github_pat_|gh[pousr]_|npm_)[A-Za-z0-9_]+/g,'[已脱敏凭据]');
}
