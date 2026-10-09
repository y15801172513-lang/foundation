export function operationFailure(error) {
  const projectDetails=error?.details||error?.diagnostic||error||{};
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
  if (['PROJECT_COMPATIBILITY_UNKNOWN','PROJECT_RUNTIME_INCOMPATIBLE','PROJECT_DOWNGRADE_INCOMPATIBLE','PROJECT_IDENTITY_REBIND_REQUIRED','PROJECT_METADATA_MISSING','PROJECT_DIRECTORY_REPLACED','PROJECT_BINDING_INVALID','PROJECT_SYNC_SCOPE_INVALID'].includes(code)) {
    const project = typeof projectDetails.project === 'string' && projectDetails.project.startsWith('/') && projectDetails.project.length <= 4096 && !/[\u0000-\u001f]/u.test(projectDetails.project) ? projectDetails.project : null;
    const reasons = ['device-changed','directory-replaced','invalid-signature','installation-binding-mismatch','project-missing','unsafe-path','unsafe-project-path','portable-binding-mismatch','capability-missing','evidence-changed-after-plan','missing-metadata','invalid-file','unreadable-file','invalid-registration','invalid-sync-scope','missing-or-invalid-file'];
    const reason = reasons.includes(projectDetails.reason) ? projectDetails.reason : 'verification-required';
    const next = code==='PROJECT_METADATA_MISSING'?`${project?`项目 ${project}：`:''}启用项目的身份或绑定资料缺失，程序尚未更新。先恢复原项目资料并只读核对；不自动解除登记、不重建身份或重新启用。`:code==='PROJECT_DIRECTORY_REPLACED'?`${project?`项目 ${project}：`:''}原目录已被替换，不能以同路径的新目录继续更新。先核对正确项目和原目录，保留文件，不自动重新绑定。`:`${project ? `项目 ${project}：` : ''}项目绑定或目标版本兼容性尚未核实。保留原安装和项目资料；先只读检查具体项目。设备身份变化时须请求显式重新绑定的新计划并本人确认，随后重新生成更新计划；不编辑登记文件、不重放旧确认。`;
    return {code,stage,retryable:false,category:'project-compatibility',next,project,reason};
  }
  if(code==='UPDATE_ENGINE_ACQUISITION_UNSUPPORTED')return {code,stage,category:'local-path',retryable:false,next:'当前已核验的旧引擎未声明标准获取缓存支持；重新下载不能增加该能力。保留安装和资料，按该版本正式支持说明处理；任何另行安装或卸载都需独立授权。'};
  if(code==='ACQUISITION_CACHE_OPERATION_ENDED')return {code,stage,category:'local-path',retryable:false,next:'该获取操作已经结束，旧材料不能作为本次未结束记录。保留旧结果，核实原进程退出及计划终态后，从正常 --update 入口发起新获取及新确认；不改terminal、不移动候选、不重放旧批准。'};
  const category=code==='ACQUISITION_TRANSPORT_FAILED'?'transport':/PATH|TRUSTED_ROOT|SYMLINK|ANCESTOR|ACQUISITION_CACHE|UPDATE_ENGINE/.test(code)?'local-path':/CANDIDATE|INTEGRITY|SIGNATURE|ACQUISITION_VALIDATION/.test(code)?'integrity':/CONFIRM|PLAN|SESSION/.test(code)?'confirmation':'engine';
  const next=category==='local-path'?'当前引擎不能安全接收此更新候选。保留原安装与已下载材料，先不要重复下载或搬移候选；核实缓存记录、来源和字节。这不是版本不兼容的证明。已结束或变化的获取记录不能重用为本次材料；核对原进程与结果后，从正常 --update 入口发起新获取及新确认，不改旧记录、不搬移候选。':category==='integrity'?'候选完整性或来源核验失败；保留证据，不执行或手工修补材料。':category==='transport'?'网络传输未完成；保留本次记录，核实网络后再明确发起获取，尚未执行安装。':category==='confirmation'?'确认或计划未完成；核实同次状态，不重放旧批准。':'当前操作未核实完成；保留结果，检查同次记录，不自动重试。';
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
