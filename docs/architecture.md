# Architecture

## 026 本地生命周期管理器边界

Foundation 用于减少意外、含糊、陈旧计划和错误归属造成的本地生命周期事故；它不防御已经拥有同一用户 shell 与不受限文件系统访问的恶意 AI 或进程，也不能阻止该进程直接修改用户文件。

这是轻量确认边界：它不以加密方式证明人在场，不防御同一用户的浏览器自动化；manager 使用的 loopback HTTP 只是内部传输，不是针对同一用户攻击者的安全边界。

AI 只能检查、请求计划、打开 Foundation 本地管理器和读取状态。确认与执行只发生在管理器内部：管理器展示 exact immutable plan 和保留边界，用户点击操作专属确认，管理器复核完整 expected-before 后才把同一份计划交给确定性引擎。plan ID、hash、浏览器 nonce、自然语言回复和可读 Skill 均不是最终确认。

项目布局 v2 将长期保留的 `identity/project.json`、`facts/**` 与可拆卸的 `integration/**`、`generated-cache/**` 分开，并由 `ownership.json` 记录精确归属。旧布局只读识别；迁移是独立、exact、管理器确认的项目操作。正常卸载只拆除可验证归属的 integration/cache，不删除 identity、facts、backups、未知文件或项目代码；永久删除项目数据是另一项逐项目高风险操作。

根目录保留 npm workspaces，公开职责由三个真实包承担：

- `@foundation/core`（`packages/core`）：路径边界、facts 读写与交叉校验、preview 配置、变化分类、上下文和迁移所需基础能力。
- `@foundation/cli`（`packages/cli`）：`foundation-kit` 命令入口，只依赖公开 package API；模板与 Skill Source 仍属于仓库级资源。
- `@foundation/management-center`（`apps/management-center`）：工作台页面、公开状态合同、HTML/view-model 和本地管理中心 HTTP 服务。

workspace 之间使用 package name 与 `exports`，不得通过 `../../` 进入另一个 workspace 的内部文件。根 `./foundation-kit` 入口和既有命令保持兼容。

## 管理中心层次

`apps/management-center/src/components/ui/` 只保存 shadcn registry 基础组件；`components/foundation/` 保存 Foundation 稳定组合组件。页面与设备 iframe/bridge 位于 `features/preview/`，信息内容和悬浮行为位于 `features/context-panel/`，纯工作台状态位于 `state/`，工作台壳位于 `workspace/`，HTTP、view-model 和 HTML 输出位于 `server/`。

`src/state/workspace-state.mjs` 是工作台状态的唯一源码权威，并由 `@foundation/management-center/state` 公开给测试。页面、复制上下文和浏览器 bridge 通过同一个 state/page ID 工作，不维护第二份页面状态。

## Preview adapter

当前只实现 `local-static` adapter。项目拥有 `.foundation/preview.json`，其中 route/asset 的 URL path 映射到项目内相对文件。页面身份和真实路由仍由 `.foundation/facts/pages.json` 管理，preview 配置只负责可访问文件映射；CLI 不猜测示例文件。

管理中心入口、稳定 JS/CSS 地址和哈希二进制资源由 `@foundation/management-center` 提供；项目页面与资源只按 preview 配置白名单提供。未来 dev-server 或跨 origin adapter 必须单独实现来源、进程和隔离策略，本轮没有代理外部开发服务器。

`local-static` 是同源可信预览：父工作台同时校验 message namespace、允许 origin 和 `event.source === iframe.contentWindow`。当前不添加 iframe sandbox，因为在没有新 bridge adapter 的情况下会破坏已批准的同源交互；未来 adapter 负责定义更强隔离边界。

## 命令式安装平台

软件生命周期平台按 `install-contract → lifecycle-manager/manager-confirmation → trusted-authority → transaction-engine → uninstall-finalizer → project-layout/project-authority → capability-authority/offer-consent → platform-bootstrap → ai-bridge → extension-adapters` 分层。`foundation-kit.json#/product/version` 是唯一产品版本权威；package 版本和管理中心模型都是受测试约束的镜像。024 历史合同见 [`docs/install-platform-024.md`](install-platform-024.md)，026 的 manager confirmation 取代了其中的 broker dependency。

027/027R1 在这条链前增加窄的 `candidate launcher → platform-account → platform-paths → first-install-bootstrap` 桥接；027R2 再以 `node-startup-environment.mjs` 的单一生成契约约束 candidate launcher、installed POSIX/Windows shim 和 bundled Node child boundary。它在 Node 启动前清除 preload/loader、外部模块 root 与 Node 生成文件路径变量，同时保留 locale、accessibility、terminal 与不产生路径写入的诊断偏好；shell 边界只用内建 `unset`/`set`，Runtime 与 entrypoint 仍由 launcher 相对绝对路径确定。它不增加 AI tool，也不提供 public apply：只有 candidate 顶层人类命令能从自身物理位置发现并验证 exact candidate；最低 platform account reader 通过 OS account record 和一致的 uid/euid/gid/egid 决定 home，环境、cwd、plan、CLI 与 AI 均不能选择 install/bootstrap roots；Foundation loopback UI 的 exact click 才进入既有生产 confirmation、authorization、Runtime 与 transaction engine。bootstrap manager state 位于用户 Caches 的产品命名空间；成功后签名 authority 转移到 installed `state`，取消、deadline expiry 或正常信号退出只保留有界 terminal pointer并释放 launcher lock。关闭页面不产生决定，server deadline 才负责确定性 no-install 清理。安装过程不扫描、注册或修改产品项目。

Source 的分层不是 candidate 的确认边界。candidate build 会将 core writer、restore、trusted-intent、manager execution context 与 HMAC/key 实现收进 CLI 或 management-center 的确定性 ESM 词法闭包，物理包中不放置可被绝对 `file:` URL 导入的 raw core mutation 模块或 protected-host adapter。candidate-derived audit 逐个导入 shipped `.mjs`，并从实际函数 call graph 证明 writer path 经过 exact manager session reserve → pre-intent → guard → consume，或既有 consumed continuation。

capability registration identity 从当前 healthy Foundation install identity 与本地管理器派生，不接受 CLI/HTTP/Skill/环境变量注入。生命周期、capability、project authority 与 generic project mutation 在 target-local guard/journal/root 写入前，先绑定 exact effect、manager confirmation reference、plan hash、target 与 before-state，再取得带进程实例指纹的 target guard、复核、consume 和执行。公共 AI surface 不导出 confirm/apply/recover/purge，公共 core 不导出 HMAC key/signing、test seam 或可变 handler registration。

项目权限独立于软件安装：`project-authority.mjs` 以 portable `.foundation/integration/binding.json` 和 installation-local signed `state/projects.json` 双重同意为 enabled 条件，并在 facts/skeleton、管理中心关系、extension、generated output 与 migration 写入前提供共同 gate；enabled 只是必要前置条件，每笔后续 mutation 仍需自己的 exact plan 与 manager confirmation。listing 只读 registration 指向的确定路径，不做目录扫描。source repository、installed root 及其 runtime/versions/state/integrations、packaged template、candidate/staging/cache/log/quarantine 和 path overlap 都不能成为用户项目；`examples/` 仅保留 source-only development-fixture 权限。

generic project mutation 由 `project-authority.mjs` 的单一事务和 `project-mutation-handlers.mjs` 的固定 catalog 执行。catalog 只包含 Foundation-owned handler；dispatcher 在 reserve 前和取得 project guard 后都重新派生 handler/payload/write set，未知或 stale binding 在首笔项目写入与 receipt consumption 前失败。consume 后崩溃由父级 signed pre-intent 与本地 signed journal 共同限定 exact snapshot restore；同一 before-state 的不同 receipt 会串行，后取得 guard 的 stale plan 必须重新规划。

候选构建、安装、更新、修复、回退和卸载验收只在仓库 `.tmp/` 内执行。产品项目及其 `.foundation/facts` 与软件生命周期根相互独立；任何软件卸载模式都不拥有或删除项目资料。

## 固定预览进程入口

根目录的 `npm run preview`、`npm run preview:status`、`npm run preview:stop` 是跨 macOS/Windows 的唯一预览入口。它们由 `scripts/preview-control.mjs` 提供，固定使用 `examples/foundation-events` 与 4317；进程控制记录仅写入系统临时目录，不进入仓库。

启动时先检查 Node 版本和现有构建产物，仅在关键产物缺失时调用 npm 构建恢复，不安装依赖。服务的 `GET /__foundation/health` 返回无敏感信息的服务身份、管理项目、端口、进程所有者标识和可安全读取的 Git commit。stop 只有在状态记录、PID 和健康身份三者一致时才发送关闭信号；未知端口占用永不关闭。
