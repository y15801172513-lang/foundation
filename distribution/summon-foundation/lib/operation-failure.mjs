export function operationFailure(error) {
  const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code||'')?error.code:'INSTALL_ENTRY_FAILED';
  const stage=/^[a-z][a-z-]{0,39}$/.test(error?.stage||'')?error.stage:'entry';
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
