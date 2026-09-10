# Foundation 对话指令

本页描述 033 的唯一工作台与对话帮助边界。实际已发布版本与安装说明以 [安装入口](install-with-codex.md) 为准，不因本文件出现就宣称本机已更新。

唯一 authority 是 `packages/core/conversation-commands.mjs`。CLI 消费（供 Codex 在对话输出），工作台不加载指令目录；本页及 Skill 的下表由 `node scripts/sync-conversation-help.mjs --write` 生成，默认命令只检查一致性。注册副本保留自包含帮助，因此即使安装失效也可以解释；执行必须重新核验 installed current。

<!-- foundation-command-catalog:start -->
| 中文意图 | 对话简写 | 用途 | 前置条件 | 确认要求 |
| --- | --- | --- | --- | --- |
| Foundation 帮助 / Foundation 指令 | fd help | 仅在对话展示指令、用途、前置条件和确认要求 | 无需启动工作台；安装未知时仅解释，不猜版本 | 不需要 |
| 打开 Foundation / 打开 Foundation 工作台 | fd open | 打开唯一 Foundation 工作台；可使用明确选定的已接入项目 | 核验安装定位记录、当前安装版本记录 和健康；无绑定时询问安装位置 | 无变更确认；启动本地服务仍须任务权限 |
| Foundation 状态 | fd status | 读取真实版本、位置、健康及 Skill/项目状态；未知不猜 | 已验证安装身份；项目只检查明确选定的目录 | 不需要 |
| 更新 Foundation | fd update | 核验发行后准备手动更新计划，保留用户数据 | 已验证当前安装与目标发行；先解释获取缓存及写入权限 | 必须本人确认精确更新计划 |
| 接入当前项目 | fd connect | 先确认实际项目及支持条件，再准备独立接入计划 | 已验证安装及精确项目；既有事实不覆盖，未确认默认不接入 | 必须本人单独确认项目接入计划 |
| 卸载 Foundation | fd uninstall | 展示属于 Foundation 的删除范围、保留项及残留，不清空目录 | 重新核验安装身份；已注册 Skill 先单独核对文件后解除 | 必须本人确认精确卸载计划 |
<!-- foundation-command-catalog:end -->

这些是对话简写，不是终端 fd 命令。语义识别由宿主完成，静态目录不证明新 Codex 任务已发现 Skill。询问、否定与引用只解释；多工具歧义只澄清一句。缺绑定不猜路径、不扫描、不自动安装。

033 恢复唯一原工作台；`workbench open --root` 使用原画布空态，可附加明确选定且已接入的 `--project`。HTML 不提供指令帮助。v0.2.4 含错误文字首页，修正随新版发行传播，不改不可变旧包。

## 取得修正

新用户需获准发布后从固定 GitHub Release 安装，检查能力 receipt，缺失时先单独 capability-install，再单独 capability-register（connectCodex: true）。已安装用户若已有注册，在更新前用旧 current 单独确认 capability-uninstall；否则更新后旧 receipt 的内容身份可能与新 manifest 不符，不能承诺直接解除。随后独立更新并重新核验稳定 launcher，从新 current 单独建立能力 receipt 并注册。旧 manager 仍用旧 UI，不能被文档倒改；未知或修改文件仍保留。最后新任务实际发现和调用才能证明可用。

## 完成告知

确认页打开后，运行中的任务继续分段等待同一操作 stdout/状态至终态或明确截止；不要先结束正常任务。页面点击不是执行证据，进程退出不是唯一终态。成功后报告真实处理范围、目录、未做事项与下一步；可说“打开 Foundation”“Foundation 指令”。停止任务是降级路径：从同一记录恢复，不承诺网页自动唤醒、不重放确认。真人点击后无需新消息的主动回复必须另做宿主验收。
