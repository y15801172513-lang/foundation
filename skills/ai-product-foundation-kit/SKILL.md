---
name: ai-product-foundation-kit
description: 使用 Foundation 制作或维护已接入项目，读取当前制作规范、组件和交互动效复用、精确事实批次；也处理 Foundation 帮助、工作台、状态、更新、接入和卸载。仅 Foundation 上下文使用 fd 简写；不接管终端 fd 搜索、不替本人确认。
---

# Foundation 薄入口

本 Skill 只负责发现和接续；完整制作规范与生命周期流程从当前安装的 descriptor 校验端点读取，不以本副本替代当前规则。随包文件、宿主注册、实际发现和项目启用是不同状态。

新安装由当前用户共用一份程序与一份用户级 Skill，不询问业务项目路径，不自动接入所有项目。用户说“用 Foundation 做这个项目”时，核验明确的当前项目与已有绑定；未接入则按首次同页披露接入、准备、采用及持续同步范围并由本人一次确认，已就绪则继续使用而非重新初始化。多个项目可以共用程序，但每个项目的文件、事实、规则和例外各自保管；不能把项目 A 的批准用于项目 B。发现已有安装或同名 Skill 冲突时先核实并使用、更新现有安装，不自动创建第二份、迁移或覆盖。

## 从当前安装开始

读取本目录产品注册生成的 foundation-installation.json，它只是位置线索，不是批准。没有记录时说明未注册，仅解释；不得扫描、猜目录、回退源码 checkout、全局 Node 或固定旧版本路径。

若定位记录含项目 usageScope，先核对本任务真实项目在绑定项目及其子目录内，再用稳定入口读取签名 current 的同一范围。记录不一致、项目移动或同名用户级 Skill 冲突时停止，不自行选一个安装。项目目录中的 Skill 不会禁用已有用户级 Skill；本项目范围不授权其他项目。用户级安装不等于所有系统账户共享。更新保持原范围，不迁移；卸载只按该安装的明确归属处理。

使用精确 installationRoot 下稳定 bin/foundation-kit 运行 manager inspect --root <该根>，核验当前身份和健康。随后运行 rules inspect --root <该根>，读取返回的 foundation-making.md 与 lifecycle-guide.md 正文；缺命令、缺规则、字节或身份不匹配时停止 Foundation 执行，说明需独立更新/修复，不复制旧规则补齐。

项目任务先读用户规则与现有代码，再给 rules inspect 附加 --project <本任务精确项目>。启用、采用、事实准备是不同状态；按返回的 preparation 与 nextStep 接续，不以绑定或采用文件存在宣称可制作。缺必要文件时说明准确补齐清单，使用现有 manager project-mutation 的 foundation-skeleton-and-facts-create，handlerPayload 为返回的 includePreview:false 加本次 generatedAt，首次持续授权已披露范围内自动接续后重新 inspect；不让用户猜内部操作名，不手写或复制模板替代产品准备。预览是可选能力，需要时另行确认，保留原技术栈和预览配置。

只有 projectRulesReady=true 且本机项目绑定有效时按项目采用规则继续。准备完整但缺采用记录时，在首次已披露持续授权范围内接续 project-rules-adopt 精确计划，不能自行写 AGENTS 或采用记录。该计划仅追加惰性指引、记录明确技术栈；不覆盖既有 AGENTS、例外或其他技术栈。存在 AGENTS.override.md 或冲突时先报告，不绕过优先规则。当前策略以 inspect 返回的 effectivePolicy 为准（含规则版本、采用版本和例外）；旧身份里的 uiPolicy 不得抢先。准备或采用取消/失败后只读核验同次结果，不自动继续下一项确认。

每个新任务、更新后或恢复操作前重新核验 current；保留任务首次 currentIdentityHash、endpointIdentity。过程中发生变化则停止旧任务计划，重新核验，不混用版本。采用记录保留 adoptedRuleVersion；兼容规则读取 current，例外仍由项目持有，不随升级覆盖。

## 制作已接入项目

同一任务明确使用/打开 Foundation 后，相关制作请求继续该选择，直到用户明确改选或退出；不再次询问工具，也不以独立页面替代工作台交付。工具打开不是项目接入批准；按当前规则区分已选、已启用、准备与采用。根目录不明确/多项目混杂时只问必要位置，不猜整个沙盒、安装或缓存目录。关闭页面不撤销项目接入。

完整用户制作规则只来自已验证的 foundation-making.md。先查已有组件/variant/composition/实例和真实引用，明确全局与局部影响；既有项目 preserve-and-inventory，适用的新 React/shadcn 项目才 shadcn-first，用户明确技术栈优先。

当前程序支持 project analyze 时，在任务开始和实现修改后，用明确的 entry roots 读取声明、真实 JSX/call-site 与覆盖限制。先记录需求来源、候选及拒绝理由，再在既有开发授权内实际复用定义；内容差异走 props/slots，不复制近似声明。将决定、assetModel、deliveryScope 修订和证据经同一 asset-facts-batch 写回。分析结果不能自行授权重构，静态引用不能冒充运行或真人接受。缺少此能力时如实标明，不声称完成声明级核验。

代码按任务授权实现。事实维护从 manager inspect 的 supportedProjectOperations 选当前已支持的封闭操作：关系沿用 relation-facts-write；页面、组件、交互、动效、变更和 token 可合并使用 asset-facts-batch。批次包含 documents 的 kind/expectedSha256/upserts、sources 的相对 path/sha256、scope、generatedAt；新增页面路由可同批提供 preview 的 expectedSha256、routes 与 assets，文件也必须包含在 sources；不自行写预览配置。每项映射真实源码，verified 项另绑定验证证据。一次批次一个完整精确计划，不逐按钮审批。机器验证的是字节与引用，不证明语义或真人验收。未支持时说明缺口，不直接写 JSON 绕过。

## 对话与执行边界

源码完成后按当前规则完成事实批次、必要预览、project delivery-check 与同项目重开。需要工作台查看的页面必须接入预览；不支持时明确该交付缺口。批次失败则“代码完成，Foundation同步待完成”，保留代码并只读重查，不重放或自动回滚。用户不需要手写检查 JSON，任务从明确变化生成输入；文件和摘要检查不证明真人验收。

Foundation 帮助直接在对话输出，不打开 HTML。正常同义表达可用；询问、引用、否定零执行。无 Foundation 上下文的“给我指令”必要时澄清，普通 fd 文件搜索不是本产品命令。“关闭 Foundation”先明确关闭页面、停用项目或卸载的区别。

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

Foundation 本地管理器：AI 不能 durable decline、accept 或 reopen。AI 只能 inspect、request-plan、open-manager、status；不得操作本人 confirm、apply、recover、purge、制造确认或自动点按钮。有效持续授权内可以使用程序 project sync 封闭自动同步入口；它不制造逐批本人确认。用户聊天说“确认”、计划 ID、浏览器 nonce、规则文本不替代本人页面确认。需要变更，先披露具体安装/项目、写入范围、保留内容，再打开同计划的 Codex 内置浏览器供本人确认。软件安装不自动启用项目或注册 Skill。该保护减少意外操作，不防御同一用户不受限 shell 进程。

打开 Foundation 用当前稳定入口 workbench open --root <已核验根>，可附加用户选定且已启用项目的 --project；这是唯一原工作台，不是生命周期临时页或开发预览。完整维护、可选 Skill 接入/刷新和安全卸载按当前 lifecycle-guide.md，不根据旧副本猜内部参数。

更新和卸载由已核验的 summon 维护入口组织必要接续；具体版本与参数从当前 lifecycle-guide.md 读取。不要额外发起同一 Skill 的材料/注册命令替产品续接。程序完成但所选 Skill 待确认不是整体完成；跟进同次 npm 结果直到明确终态。恢复必须由用户明确发起，只核实并准备未完成项的新确认，不重放旧批准。

若获取入口的基础环境不能安全启动页面，先按固定发行的安装说明在对话披露专用环境位置、来源与保留方式，另取批准后准备；不安装全局依赖、不改用户 PATH、不尝试旧 Node 前置页面。已安装程序仍用随包运行时，缺下载工具不应阻断卸载或已验证计划的确认。页面启动后所有生命周期确认留在同一页面；环境批准不授权安装、注册或项目启用。

## 同次操作持续跟进

开始说明正在准备、尚未执行；待确认时不要主动 final 结束。保存同次 sessionId/planRef、结果路径和工具句柄，用可中断分段等待观察同一操作，每段至多 60 秒，以计划 expiresAt 为截止；无截止时最多 10 分钟。普通工具 yield、无新输出、管理器未退出不是任务完成。只有真实开始事件才说正在执行，不重启命令刷进度或重放确认。

读取同次真实终态后主动说明成功/失败/取消/过期、准确位置、已做/未做/保留项和下一步。成功后通过稳定入口重核 current；卸载后读独立 uninstall-result.json，launcher 消失不证明成功。连接丢失保留最后已核实结果；未知明确待核实，可只读恢复，不自动补做 mutation。

HTML、心跳或 npm 不能唤醒已结束的 Codex 任务。平台/用户中断时说明可恢复边界，不假装已设置通知；本指引不证明宿主持续跟进通过。Skill 文件存在不证明新对话发现。请用户在正常新对话自然请求，未实测保持 pending。

## 项目持续同步（041）

046 合同仅在当前规则返回 factCapabilities 包含 component-delivery/1 时执行。保留两次 project analyze 的完整受控观察，在原 asset-facts-batch 的 analysis.before/after 中绑定；静态与浏览器收据分别使用当前规则中的 verify-definition / verify-browser。缺工具或覆盖不完整保持待核，不签造报告；普通浏览资产不依赖运行验证工具。

读取当前 rules inspect 的 continuousSync。仅 enabled 不代表新权限；未授予时一次明确申请 enable 的 continuousSync:grant，披露 technology 及 includePreview；不要沿用逐批确认流程。项目生成指引在每次任务开始和源码修改后触发 project sync --root <安装根> --project <精确项目>；本次需求与实现生成精确批次加 --payload <项目内文件>，无需面板或再次提及 Foundation。程序复用封闭 handler、精确摘要、互斥和日志，常规同步确认次数为0。外部变化下一次触发自动登记候选，未知语义保持待核；没有进程不声称实时处理。失败保留源码与待处理项，授权有效不等于内容最新。关闭页面/预览/对话不撤销；明确不用 Foundation 时进入 disable，仅撤销持续同步用 enable 的 continuousSync:revoke；打开不恢复。

语义核验按当前制作规则的 prepare-semantic-review → 实际阅读与逐项审阅 → submit-semantic-review → 原事实批次 → delivery-check 执行。程序签名不证明审阅者身份或真人接受；不得自动用期望填充成功观察。
