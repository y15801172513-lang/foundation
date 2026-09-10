// One catalog authority. These are conversational intents, never shell aliases.
export const conversationCommands = Object.freeze([
  {id:'help', chinese:'Foundation 帮助 / Foundation 指令', alias:'fd help', purpose:'仅在对话展示指令、用途、前置条件和确认要求', prerequisite:'无需启动工作台；安装未知时仅解释，不猜版本', confirmation:'不需要', route:'--help'},
  {id:'open', chinese:'打开 Foundation / 打开 Foundation 工作台', alias:'fd open', purpose:'打开唯一 Foundation 工作台；可使用明确选定的已接入项目', prerequisite:'核验安装定位记录、当前安装版本记录 和健康；无绑定时询问安装位置', confirmation:'无变更确认；启动本地服务仍须任务权限', route:'workbench open --root'},
  {id:'status', chinese:'Foundation 状态', alias:'fd status', purpose:'读取真实版本、位置、健康及 Skill/项目状态；未知不猜', prerequisite:'已验证安装身份；项目只检查明确选定的目录', confirmation:'不需要', route:'manager inspect --root'},
  {id:'update', chinese:'更新 Foundation', alias:'fd update', purpose:'核验发行后准备手动更新计划，保留用户数据', prerequisite:'已验证当前安装与目标发行；先解释获取缓存及写入权限', confirmation:'必须本人确认精确更新计划', route:'manager request-plan --operation update'},
  {id:'connect', chinese:'接入当前项目', alias:'fd connect', purpose:'先确认实际项目及支持条件，再准备独立接入计划', prerequisite:'已验证安装及精确项目；既有事实不覆盖，未确认默认不接入', confirmation:'必须本人单独确认项目接入计划', route:'manager request-plan --operation enable'},
  {id:'uninstall', chinese:'卸载 Foundation', alias:'fd uninstall', purpose:'展示属于 Foundation 的删除范围、保留项及残留，不清空目录', prerequisite:'重新核验安装身份；已注册 Skill 先单独核对文件后解除', confirmation:'必须本人确认精确卸载计划', route:'manager request-plan --operation uninstall'},
]);

export function conversationHelp() {
  return '以下 fd 简写仅用于 Codex 对话，不是终端 fd 命令。询问、引用和否定只解释，不执行。\n\n' +
    conversationCommands.map(c => `${c.chinese}（${c.alias}）\n用途：${c.purpose}\n前置：${c.prerequisite}\n确认：${c.confirmation}`).join('\n\n') + '\n\n命令行入口：workbench open --root <已核验安装根>[--project <明确选定的已接入项目>]（同一工作台，不另建首页；帮助不打开 HTML）。';
}

export function conversationHelpMarkdown() {
  return '| 中文意图 | 对话简写 | 用途 | 前置条件 | 确认要求 |\n| --- | --- | --- | --- | --- |\n' +
    conversationCommands.map(c => `| ${c.chinese} | ${c.alias} | ${c.purpose} | ${c.prerequisite} | ${c.confirmation} |`).join('\n');
}
