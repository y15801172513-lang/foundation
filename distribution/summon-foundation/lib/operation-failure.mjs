export function operationFailure(error) {
  const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code||'')?error.code:'INSTALL_ENTRY_FAILED';
  const stage=/^[a-z][a-z-]{0,39}$/.test(error?.stage||'')?error.stage:'entry';
  if(code.startsWith('GITHUB_')){
    const sources=['anonymous','GH_TOKEN','GITHUB_TOKEN','gh','none'];
    const source=sources.includes(error?.diagnostic?.source)?error.diagnostic.source:'none';
    const category=/RATE_LIMIT/.test(code)?'rate-limit':/AUTH/.test(code)?'authentication':code==='GITHUB_API_FORBIDDEN'?'forbidden':'http';
    const seconds=error?.diagnostic?.retryAfterSeconds;
    const retryAfterSeconds=Number.isSafeInteger(seconds)&&seconds>=0?seconds:null;
    const next=category==='rate-limit'?`GitHub 限流（来源 ${source}）；${retryAfterSeconds===null?'按服务提示等待':`至少等待 ${retryAfterSeconds} 秒`}后再发起获取。匿名用户可显式选择 --github-auth gh。`:category==='authentication'?`GitHub 认证失败（来源 ${source}）；核实对应环境凭证，或自行检查 gh auth status --hostname github.com 后选择 --github-auth gh；也可明确选择 anonymous。`:category==='forbidden'?`GitHub API 权限不足（来源 ${source}）；核实凭证权限与组织策略，不自动回退匿名。`:'GitHub API 请求未完成；核实发行与服务状态后再发起获取。';
    return {code,stage,category,source,retryAfterSeconds,retryable:error?.retryable===true,next};
  }
  if (['PROJECT_COMPATIBILITY_UNKNOWN','PROJECT_RUNTIME_INCOMPATIBLE','PROJECT_DOWNGRADE_INCOMPATIBLE','PROJECT_IDENTITY_REBIND_REQUIRED'].includes(code)) {
    const project = typeof error?.details?.project === 'string' && error.details.project.startsWith('/') && error.details.project.length <= 4096 && !/[\u0000-\u001f]/u.test(error.details.project) ? error.details.project : null;
    const reasons = ['device-changed','directory-replaced','invalid-signature','installation-binding-mismatch','project-missing','unsafe-path','unsafe-project-path','portable-binding-mismatch','capability-missing','evidence-changed-after-plan'];
    const reason = reasons.includes(error?.details?.reason) ? error.details.reason : 'verification-required';
    const next = `${project ? `项目 ${project}：` : ''}项目绑定或目标版本兼容性尚未核实。保留原安装和项目资料；先只读检查具体项目。设备身份变化时须请求显式重新绑定的新计划并本人确认，随后重新生成更新计划；不编辑登记文件、不重放旧确认。`;
    return {code,stage,retryable:false,category:'project-compatibility',next,project,reason};
  }
  const category=code==='ACQUISITION_TRANSPORT_FAILED'?'transport':/PATH|TRUSTED_ROOT|SYMLINK|ANCESTOR|ACQUISITION_CACHE|UPDATE_ENGINE/.test(code)?'local-path':/CANDIDATE|INTEGRITY|SIGNATURE|ACQUISITION_VALIDATION/.test(code)?'integrity':/CONFIRM|PLAN|SESSION/.test(code)?'confirmation':'engine';
  const next=category==='local-path'?'当前引擎不能安全接收此更新候选。保留原安装与已下载材料，不重复下载或搬移候选；核实版本兼容性。旧引擎不支持时，须另行确认保留项目资料后的卸载与新版首装。':category==='integrity'?'候选完整性或来源核验失败；保留证据，不执行或手工修补材料。':category==='transport'?'网络传输未完成；保留本次记录，核实网络后再明确发起获取，尚未执行安装。':category==='confirmation'?'确认或计划未完成；核实同次状态，不重放旧批准。':'当前操作未核实完成；保留结果，检查同次记录，不自动重试。';
  return {code,stage,retryable:error?.retryable===true,category,next};
}

export function installedCommandFailure(result) {
  let value;
  for(const text of [result.stderr,result.stdout]){
    if(typeof text!=='string'||text.length>65536)continue;
    try{const parsed=JSON.parse(text);value=parsed.error||parsed;if(value?.code)break;}catch{}
  }
  const detail=operationFailure(value||{code:'INSTALLED_COMMAND_FAILED',stage:'installed-command'});
  // Never forward arbitrary stderr/message/details, credentials or plan nonces.
  return Object.assign(Error(detail.next),detail,{diagnostic:detail,exitCode:result.status});
}
