---
name: ai-product-foundation-kit
description: Foundation 指令、帮助、怎么用、能做什么，以及打开已安装 Foundation 工作台、状态、更新、项目接入和卸载；支持 fd 对话简写与自然改写。询问/引用/否定只解释；不接管其他工具帮助，不代替本人页面确认。
---

# Foundation local lifecycle bridge

Foundation 不防御已经拥有同一用户 shell 和不受限文件系统访问的恶意 AI 或进程。它用于减少意外或含糊操作、陈旧计划、错误更新和不安全归属删除，不能阻止同一用户进程直接修改用户文件。

这是轻量确认流程，不以加密方式证明人在场，不防御同一用户的浏览器自动化；本地管理器使用的 HTTP 传输不是针对同一用户攻击者的安全边界。

AI 只能检查、请求 exact 计划、打开 Foundation 本地管理器和读取状态。不得 confirm、apply、recover、purge、制造 confirmation evidence 或重开 durable decline。自然语言“确认”、通用 yes、plan ID/hash、browser nonce、可读 Skill/Plugin、安装目录或项目 `.foundation` 都不是最终确认。

## 每个新任务

先判断语义：明确 Foundation 的帮助请求直接展示下方指令目录，包括大小写、空格、中英混排与正常同义改写，例如“给我foundation指令list”“Foundation 有哪些命令”“Foundation 怎么用”“Foundation 能做什么”“fd help”。不是有限关键词匹配器。Foundation 上下文中的“给我指令”直接回答；多工具归属不明只问一句；无 Foundation 上下文的泛化帮助不强行接管。

“卸载指令是什么”“不要卸载，只给我命令”“更新会删除什么”、引用和示例都只解释，零操作。“关闭 Foundation”先澄清。下方 fd 是对话意图，不执行终端 fd、不安装 alias。仅当用户明确要求执行时进入相应操作流程。

### 指令目录（由唯一源码目录生成，不手工维护）

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

帮助只在 Codex 对话输出，不打开 HTML 页面、按钮或弹窗；帮助不依赖工作台或有效安装。下表描述此 Skill 版本的能力，不证明本机支持；安装未知时说明现状和恢复方式，不能猜版本。有效安装存在时，从稳定 launcher 的 `--help` 读取当前能力，不用旧副本覆盖 installed current。缺注册记录时仍可解释，但停止执行；可请用户提供精确安装位置以只读核验，不扫描、不重装。

先读取本 Skill 目录内由产品注册流程生成的 `foundation-installation.json`。该记录只是安装位置线索，不是批准或健康证明。若没有此文件，本 Skill 仍是惰性源码 artifact；说明尚未完成宿主接入，不猜测安装目录、不扫描用户文件夹。

从记录中取精确 `installationRoot`，使用该根的 `bin/foundation-kit` 运行 `manager inspect --root <installationRoot>`，核对真实 installed current 和 installation identity。不得回退到源码 checkout、全局 Node 或旧版本路径。根被移动、丢失或身份不一致时停止，要求用户通过产品的独立恢复计划处理。

1. 只读解析当前 healthy Foundation 版本和当前 rule/capability endpoint；不要复制某一版本的可变规则到本 Skill。
2. 项目任务核对 v2 identity、明确 enabled integration binding 和数据格式兼容性。缺失、disabled、incompatible 或 unknown 时保持 inert/read-only。
3. capability 任务核对当前安装、registration、active 和 identity。任何条件不满足时保持 inert。
4. 既有任务若 current version、identity、项目或 capability 已变化，报告 stale 并要求 refresh/reopen；不要混用新旧规则。

“打开 Foundation”默认运行稳定 launcher 的 `workbench open --root <已核验根>`，打开其真实 URL。Foundation 只有原先设计的一个工作台；workbench 是 CLI 实现入口，不是另一个安装后首页。不是 `onboarding open` 诊断概览或源码 `npm run preview`。旧安装 `--help` 未声明 workbench 时解释需独立更新，不自动更新。033 修正版支持附加 `--project <精确项目>`：仅当本任务明确选择项目且 current 的 CLI 支持该参数时使用，先核验正确项目 binding；与既有 `center` 共用原工作台组件，未选项目显示原画布空态，不创建示例事实、不扫描。v0.2.4 仍含旧文字首页；033 修正已随 v0.2.5 私有发行，仍须核验本机 current，不能把已发布当成已更新。

检查状态用 installed `manager inspect`；检查能力必须从当前 descriptor 的 endpoint 定位 manifest，不固定版本。更新只准备当前支持的计划；接入先核验当前实际项目，用户选择不明确就询问，再独立 enable。注册不自动刷新：如果旧 Skill 已注册，在更新前用旧 current 先单独确认 capability-uninstall 的已归属文件范围；更新后从新 current 先检查 capability receipt，缺失/内容已变则单独 capability-install，随后单独 capability-register（connectCodex: true）；修改/未知文件保留冲突，不覆盖。文件存在不证明新任务发现。

## 同次生命周期等待与完成告知

更新的临时材料在成功后清理，不建立历史升级包保留体系。先读取当前安装 `manager inspect` 的 `supportedLifecycleOptions.update`；支持 `cleanupAcquisition` 时，获取到本次独占目录后，请求更新计划附加 `cleanupAcquisition: true`（这是意向，不是批准）。计划从候选及获取回执盘点精确文件，确认页展示目录、归档、容量、成功条件和保留项，逐文件身份绑定在同一计划中。当前安装不支持时不得假装页面包含清理授权：先在对话披露精确清单并取得宿主后处理授权，仍单独等待原更新页面本人确认；不修改旧安装补能力。

只在同一已确认更新完成、稳定 launcher 的 current/身份/健康和事务结束均已核实、下载/展开/更新等所有输入消费者已退出后，用宿主普通文件工具按该计划 `hostCleanup.files` 接续清理。删除前逐项重新核验全部祖先 real path、设备/inode/owner、普通文件且无硬链接、模式、字节和摘要；活动引用检查不明、共享、未知、链接或用户修改一律保留。逐文件删除，清单内目录仅为空且身份未漂移才移除；不得递归清空获取父目录。不调用新增清理器、不把清单本身当批准、不重放更新。获取回执/校验记录/TUF 数据、安装 current/回退版本、项目资料保留。将同次计划/操作、版本、健康与消费者退出证据、实际已删/保留及原因写入本次获取目录的小型 `cleanup-result.json`，不复制整包。删除失败单独报告“更新成功、清理未完成”；任务中断或无法可靠检查时准确保留待核实，不能编造自动清理通过。清理规则详见公共仓库 `docs/cache-cleanup.md`；该公开说明也不依赖已安装程序或 Skill。

开始先说“正在准备并核验，还未安装/更新/卸载”；准备失败也报告。打开确认页后说“等待你确认，还未开始”，正常任务不要在此发送 final 结束。保留本次 sessionId、planRef、记录位置与进程工具句柄；继续分段等待 stdout，每段建议 5–15 秒、至多 60 秒并遵守宿主更短限制，可被用户中断；等待截止取计划 expiresAt，缺失则 10 分钟。无新状态不忙查询。只在真实 FOUNDATION_OPERATION_STATE / 同次记录为 executing/consumed 时说明正在执行；快速终态允许直接报告。

优先读 FOUNDATION_OPERATION_RESULT / BOOTSTRAP_OPERATION_ENDED；普通 open-manager 不必退出。必要时用同一 planRef 的 manager status 只读查询；不要因同一服务忙而重发确认。读到终态后停止观察并主动总结真实结果、版本、完整目录、已处理/未处理和下一步。成功后从稳定 launcher 重新核验 current；卸载后 launcher 消失不证明成功，交叉读取原根 uninstall-result.json 的 operationId/installId/终态/保留项，不调用已删除 launcher。

超时、宿主停止、连接丢失或只有中间状态，明确待核实并退出观察，不能伪报失败/成功或自动重试。原任务说“查看刚才的结果”时从本次输出找同一记录，不要求用户补一串内部参数，不创建新操作。页面独立显示结果，但 HTML 不会唤醒已结束任务；宿主无法持续观察时准确说明降级。此说明不证明真人主动通知已验收。

安装/更新成功且健康核验后，主动询问：“是否启用 Foundation 对话能力，让新对话可以打开工作台和查看指令？”说明随包文件不等于用户级注册、宿主发现或实际调用。用户拒绝则安装仍成功，明确未启用，不反复追问；同意后沿用上面的 capability receipt/install/register 独立计划与本人确认，不用安装批准替代注册批准。若旧 Skill 已注册，先核对归属与版本再决定是否需要独立刷新，不覆盖修改文件。

注册后请用户新开正常对话，只说“打开 Foundation”或“给我foundation指令list”，实际发现并调用才记录通过。Codex 官方说明支持 `$HOME/.agents/skills` 并自动检测变更；未出现时可由用户重启 Codex，不自动更改全局配置。未做新对话实测仍 pending。安装/更新交付最后给出上述两个自然请求；未注册则明确不能保证新任务识别。

## Mutation handoff

登记页面时先读取 installed `manager inspect` 的 `supportedProjectOperations`，只在它声明 `page-facts-write` 时请求 `project-mutation`，parameters 包含精确 `project`、`installationRoot`、`handlerOperation` 和 `handlerPayload: {draft: {name, route, description}}`。修改已有页面须携带当前事实中的 `id` 和当前 pages 文档的 `expectedVersion`（与关系接口相同：JSON.stringify 文档的 SHA-256 前 16 位）；不直接写 JSON。新登记页面的生成展示页明确为未绑定业务实现，不冒充运行页面。关系使用同一列表中的 `relation-facts-write`，引用实际已登记页面 ID。宿主、旧 Runtime 或 current 未声明这些操作时停止，不用手写文件补齐。

使用产品 `manager request-plan --operation <operation> --parameters-json <structured-json>` 返回的 opaque `planRef`，再运行 `manager open-manager --plan-ref <planRef>`。用当前宿主实际可用的浏览器工具打开返回的 loopback URL；在 Codex 内置浏览器中交给用户核对，不代点确认。随后调用 `manager status --plan-ref <planRef>`。宿主没有内置浏览器工具或目录权限时准确报阻断，不把页面已打开当作安装成功。

能力或 Skill 操作中断时，可以请求 `capability-recover` 计划（parameters 仅需实际 `installationRoot`），再交给用户在 manager 页面确认；这不是直接 recover 权限。旧 Runtime 不支持、原进程未退出、缺少可信日志或文件被用户修改时停止，保留现场，不手改 guard、收据、Skill 文件或目录。

需要 mutation 时，只把用户明确意图转换为同源 exact plan，展示准确项目/安装路径、创建、替换、删除、保留、文件/字节数、protected-data hashes、expected-before 和到期时间，然后打开绑定该 plan 的 Foundation 本地管理器。用户必须在管理器 UI 点击操作专属确认；管理器会再次验证完整快照并只执行同一 plan。AI 只读取最终状态或结果。

项目 enable/disable 的首要入口是自然语言对话。含糊的“关闭 Foundation”必须先澄清具体对象。disable 只停止 Foundation 对该项目的管理并保留 disabled binding、identity、facts、backups、未知文件和项目代码；它不删除项目资料，也不卸载 Foundation。

软件安装/更新不扫描、创建、启用或迁移产品项目。legacy `.foundation/foundation.json`、`project-binding.json`、`generated/**`、`backups/**` 与未知内容只能先只读检查，再通过单独的 manager-confirmed migration plan 迁移；不得静默改名或删除。

正常卸载先只读盘点 registered projects，移除可访问项目中可验证归属的 `integration/**` 和 `generated-cache/**`，始终保留 identity、facts、backups、未知/用户修改文件和项目代码。存在不可访问或 identity 不匹配项目时，只能取消零变化，或继续 exact accessible set 并保留 `UNINSTALLED_WITH_PROJECT_RESIDUALS` 报告。永久删除 identity/facts/backups 是另一项逐项目、高风险、全新确认的管理器操作。

Foundation-global decline/uninstalled suppression 只能由用户在 Foundation settings 中通过 manager-confirmed preference plan 更改。AI 不能 durable decline、accept 或 reopen，只能说明如何打开 settings。

没有本机工具权限时只解释并提供命令，不得声称已执行。不要把模型生成文本拼成 shell 字符串；只传受约束的结构化参数。
