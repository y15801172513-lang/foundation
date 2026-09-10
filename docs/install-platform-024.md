# Foundation 安装与生命周期合同

本文件沿用 024 路径，描述现行本地确认与所有权边界。已封存的 025 protected-host/broker 不是现行 authority，也不因阅读历史资料而恢复。当前获取步骤见 [Codex 安装说明](install-with-codex.md)，以实际公共 Release/npm 核验结果判断可用性，历史阶段报告不替代当前状态。

## 确认和执行边界

用户体验是公共 GitHub/npm 入口 → Codex 检查/选择 → 内置浏览器精确计划 → 用户确认 → 程序执行 → 页面结果与对话补充。没有实际发行或缺工具/权限时安全停止，不凭本文宣称安装可用。

AI 和普通 CLI 只能 inspect、request-plan、open-manager、status，不拥有 confirm/apply/recover/purge 入口。恢复可以请求单独计划，但只能由 manager 消费该计划的操作专属确认。聊天“好”、通用 yes、plan hash、目录参数和浏览器 nonce 都不是独立批准。宿主工具权限也不替代 manager 确认。

现行 manager 使用本地软件确认、不可变 effect、单次消费、期限、写前日志与互斥 guard，减少含糊操作、陈旧计划、错误路径和不安全删除。它不是受保护的人类在场证明，不防御已经拥有同一用户 shell/文件系统/浏览器自动化权限的恶意进程。HMAC 保护记录完整性，不能据此宣称操作一定由人发起。

## 执行面与路径归属

- 源码执行面：只允许本仓库真实 `.tmp/` 的受约束操作。`--sandbox-root` 是 advisory，不扩大 authority；不写真实安装根、用户 Skill 或其他项目。
- 首装候选：使用绑定的 Runtime 和 CLI；macOS OS account 来自 `os.userInfo()`，核对实际 UID/GID。默认安装位置为 account 的 `Library/Application Support/AI Product Foundation Kit`。
- 目录选择：`install --destination <绝对路径> --browser codex` 只是意向，须规范化、拒绝 symlink/路径漂移，并进入同一候选、身份、空间、文件范围和用户确认计划。自选目录父目录必须真实存在；未知非空目录不清空，不自动迁移旧安装。
- Installed 执行面：launcher 从自身已安装位置解析 current、Runtime、manager、Bridge 和生命周期根，不回退到源码或全局 Node。
- account 的 `Library/Caches/AI Product Foundation Kit/bootstrap-manager` 存储首次确认会话；新获取入口另有已披露获取缓存。自选目录不意味着系统其他位置没有文件。HOME、USER、LOGNAME 和 AI 自报目录都不是 account authority。

安装前页面显示实际版本/候选身份、real path、Runtime、空间、创建/替换/删除/保留位置及项目扫描数 0。取消、过期、SIGINT/SIGTERM 不安装；关浏览器不算确认或取消。SIGKILL、路径变化和事务中断需要独立恢复计划；未知证据保持 fail-closed。完成指针不等于健康证明，重开后以 installed current 和实际 health 为准。

## 代码责任

|模块|现行责任|
|---|---|
|`product-version.mjs`|读取 `foundation-kit.json#/product/version`，验证 package 镜像|
|`candidate-package.mjs` / `official-node-runtime.mjs`|候选完整 inventory、模式/大小/哈希、架构和官方 Runtime；独立签名分支暂缓，GitHub 来源由获取入口另行核验|
|`first-install-bootstrap.mjs` / `platform-paths.mjs`|首次计划、可选目录、会话/恢复/重装与 OS account 默认路径|
|`lifecycle-manager.mjs` / `lifecycle-manager-host.mjs`|结构化请求、精确 loopback 页面、结果查询；AI 不批准|
|`human-authorization.mjs` / `manager-confirmation.mjs`|同一 operation/plan/目标/before-state 的保留、验证和单次消费|
|`transaction-engine.mjs` / `trusted-intent-ledger.mjs`|写前日志、进程实例互斥、安装/更新/repair/rollback/uninstall 和独立 recovery|
|`capability-authority.mjs` / `codex-skill-registration.mjs`|惰性 artifact、安装/注册/启用独立条件，精确 Skill 文件归属和写前恢复|
|`project-authority.mjs` / `project-layout.mjs`|明确 opt-in、身份绑定、项目移动/复制/权限变化、停用和正常卸载保留|
|`project-mutation-handlers.mjs`|固定 handler catalog、canonical payload、允许写集、前态和已授权 dispatcher；不开放任意写路径|
|`ai-bridge.mjs` / Skill|解析 installed current、规则端点、capability 与 project binding；陈旧任务不得混用新旧规则|

## 项目、Skill 与删除

软件安装/更新不自动扫描、创建、接入或迁移产品项目。项目默认为 unmanaged，单独 enable 不等于批准后续事实修改。项目 list 只读已登记项目，不扫描用户 Documents、home 或 Git 仓库。disable 保留 identity、facts、backups、未知内容与项目代码。

Codex Skill 内部 registration 不等于宿主可见。用户级注册必须通过独立 `capability-register` 计划明确选择 `connectCodex: true`；目标是 OS account 的 `.agents/skills/ai-product-foundation-kit`。同名非空内容不覆盖；需要实际新任务发现和调用证据。Skill 中断可请求 `capability-recover`，但不能手写收据或清 guard。缺少写前日志的旧事务保留并阻断。

普通卸载只删除确证 owned 且未改的内容，保留用户修改、未知归属、项目代码、identity、facts 和 backups；删除项目长期事实属于另一个明确高风险操作，本轮不执行。已有 Skill 归属记录时先单独确认停用，再卸载软件。不同卸载模式和 finalizer 必须重新验证签名归属、路径、current/index/receipt；不可访问项目形成 residual，不伪装清理完成。

所有 normal inspect/status/doctor 都只读，不自动抢锁、修复或重试已消费操作。失败后按确证的 before/after 和 recovery scope 恢复；无法验证的文件保留。自选根已做部分两版本更新/回退、repair、app-only 卸载/重装工程验证；不等于 full 模式、真实用户或独立 Review 全部通过。

## 构建、获取与平台信任

`npm run candidate` 默认复制本机 Node，仍是来源未验证的 local-development 工程候选。维护者可用 `--runtime-archive` 提供固定 Node 24.14.1 的官方 arm64/x64 归档；构建器先验归档，再提取固定 Node/LICENSE，绑定每个成员摘要和 provenance。输出/工作目录只能是 `.tmp/` 新目录，不覆盖旧版本或失败证据。

candidate 和 installed launcher 都使用私有 Runtime；清除 NODE_OPTIONS、NODE_PATH、NODE_V8_COVERAGE、NODE_REDIRECT_WARNINGS、NODE_COMPILE_CACHE、NODE_COMPILE_CACHE_PORTABLE、NODE_PRESERVE_SYMLINKS。所有 shipped ESM 必须完成无外部依赖的模块闭包检查；raw write/restore/sign/key/mint、测试控制或未知 writer 阻断候选。

`release-catalog.mjs` 保留 GitHub 固定仓库、版本/commit、有效期、归档和 Runtime 绑定校验。生成器只接受 `--github-catalog`，调用宿主 gh 核验并下载；不要求独立密钥，不将 unsigned 改称 verified-distribution。`onboarding inspect` 不查远端，发布 unknown、获取 not-checked；版本来自可信入口清单，只有当次真实校验通过才报告获取成功。旧签名/HTTPS 实验不参与当前发布步骤，真实 GitHub 获取仍待验收。

官方 Node SHA-256 及 macOS 签名检查，不等于 Foundation 整体签名、公证或正式可获取。macOS 命令行/归档交付不强制采用 DMG，但实际下载隔离、Gatekeeper、Developer ID/公证和正常执行条件仍需验证；不删除 quarantine、不关闭安全检查。Windows 与 Intel 实机未验收，不能从本机 arm64 工程结果推导通过。telemetry 默认关闭。

依据：[Codex Skills](https://learn.chatgpt.com/docs/build-skills)、[Codex Browser](https://learn.chatgpt.com/docs/browser)、[Node 二进制校验](https://github.com/nodejs/node#verifying-binaries)、[Apple 公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。当前核对与实际验证限制见 030R1 Result；历史 024/025 记录不作为现行执行批准。
