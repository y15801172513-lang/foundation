# CLI 参考

## 035 安装入口修正（0.2.7 / npm 0.1.2）

npm 0.1.2 的 `summon foundation` 默认准备安装，只有 `--inspect` 是只读发行发现。未给目录时由已验证候选的 `install --choose-destination --browser codex` 打开目录选择阶段；选择只产生意向，下一页仍须本人确认精确计划。`--choose-destination` 与 `--destination` 互斥。系统浏览器不是自动备用，对话是否主动告知仍须真实宿主验收。

036 本地候选（尚未发布）在联网前记录同次获取，`--status <本次返回的结果文件>` 只读恢复；大文件输出实际字节、最多两次有界获取。新运行版将稳定入口健康检查并入安装/更新结果，安装启动器负责工作台就绪，不等服务退出。更新的 `updateCleanupExecutor: confirmed-update-engine` 表示已确认暂存由程序精确处理；旧版没有该声明则保留暂存，不由模型补执行。安装、工作台就绪、Skill 注册及新对话发现分别报告。

现有显式 `--prepare --version <版本> --destination <目录>` 与更新获取 `--acquire --version <版本>` 保留；更新仍由稳定 installed launcher 处理。新参数不能用于未声明该能力的旧运行版。npm 0.1.2 / 运行版 0.2.7 已发布；安装前仍须核验实际发行与资产，帮助文本不替代来源证明或真人验收。

运行 `./foundation-kit --help` 可查看当前对话安装、结果查询和再次打开入口；显示“实现中”即不代表 GitHub 用户路径已就绪。

发布后的后台入口由 Codex 调用，不要求用户手写参数：`--inspect` 返回绑定的版本与 Release 获取合同；`--version <版本> --github-client <已核验宿主 gh 实路径> [--destination <目录意向>]` 自动取得精确 Release 资产，仍需管理器页面确认才安装。当前最小 GitHub 入口不接受 `--archive` 跳过来源核验；该参数只保留于后置的旧独立签名模式。最小入口不需要独立发行密钥，当前阻断是尚未保存/发布本轮精确版本，不是缺私钥。

本文从当前 `packages/cli/index.mjs` 与 `packages/cli/lifecycle.mjs` 整理。仓库根 `./foundation-kit` 是源码开发入口，需要本机 Node.js；candidate 顶层 `foundation-kit` 是另一个自带 Runtime 的入口，不要混用。

所有 mutation 的共同顺序是：只读检查 → exact plan → opaque `planRef` → Foundation 本地管理器 → 用户确认 → effect → 验证。普通 CLI `apply` 已关闭。

## 1. 软件生命周期

受众：Foundation 维护者和隔离验收人员。读取 candidate、平台与安装状态；确认后可能写安装根、版本、Runtime、journal、receipt 与 integration 状态。真实用户路径仍 `pending`。

```sh
./foundation-kit install plan --root <installation-root> --sandbox-root <test-root> --candidate <candidate-directory>
./foundation-kit update plan --root <installation-root> --sandbox-root <test-root> --candidate <candidate-directory>
./foundation-kit repair plan --root <installation-root> --sandbox-root <test-root>
./foundation-kit rollback plan --root <installation-root> --sandbox-root <test-root>
./foundation-kit recover plan --root <installation-root> --sandbox-root <test-root>
./foundation-kit uninstall plan --root <installation-root> --sandbox-root <test-root> --mode app-only
./foundation-kit doctor --root <installation-root>
```

`install|update|repair|rollback|recover|uninstall plan` 只输出计划；`--plan-out` 被拒绝。effect 需要 `manager request-plan` 与界面确认。`--root`/`--sandbox-root` 是当前 developer/test-only planner 参数，不是普通用户路径或写入授权。出错时先运行 `doctor` 或 `recover plan`；不要手删 lifecycle 状态。

candidate 首次启动支持下列入口；目录参数只是意向，仍需页面确认：

```sh
"<candidate-directory>/foundation-kit" install
"<candidate-directory>/foundation-kit" install --destination <absolute-directory> --browser codex
```

它验证 candidate 并打开本地确认界面；当前 real-user acceptance 未完成。

`--browser codex` 只返回受控 loopback URL，由宿主打开内置浏览器，不自动打开系统浏览器。首装前检查和首装操作记录查询：

```sh
./foundation-kit onboarding inspect --destination <absolute-directory>
./foundation-kit onboarding status --session-id <operation-session>
./foundation-kit workbench open --root <installation-root>
./foundation-kit workbench open --root <installation-root> --project <enabled-project>
# 只读诊断概览，不是工作台
./foundation-kit onboarding open --root <installation-root>
```

`inspect` 不创建目录或 manager state，不查远端，`availableVersions` 为空；`release.remoteQuery` / `remoteAcquisition` 为 `not-checked`，`publication` 为 `unknown`，独立签名单列，不用 unsigned 推断未发布。可选版本读取对应可信 GitHub 入口的 `--inspect` 清单，仍不证明远端存在。获取成功事件只由真实校验流程输出，不接受调用方布尔证明。`status` 终态记录不是 installed health 证明，需核验 installed launcher/current。`open` 返回真实安装概要，不以示例项目伪装空状态。已安装使用经安装根 `bin/foundation-kit`，不是源码入口。

## 2. 项目生命周期

受众：项目负责人。`inventory`、`status`、`list`、`intent` 与 plan 阶段只读项目或安装登记；用户确认后 enable/disable/recover 可能写 portable binding、机器登记与事务状态。

```sh
./foundation-kit project inventory --project /absolute/path/to/product
./foundation-kit project status --project /absolute/path/to/product --root <installation-root>
./foundation-kit project list --root <installation-root>
./foundation-kit project intent --text "启用这个项目" --project /absolute/path/to/product --root <installation-root>
./foundation-kit project enable plan --project /absolute/path/to/product --root <installation-root>
./foundation-kit project disable plan --project /absolute/path/to/product --root <installation-root>
./foundation-kit project recover plan --root <installation-root>
./foundation-kit create plan --project /absolute/path/to/new-product --root <installation-root>
./foundation-kit upgrade plan --project /absolute/path/to/product --root <installation-root>
```

`inventory` 是临时只读盘点，不表示同意。`create plan` 只规划 template 创建；`upgrade plan` 只对已启用项目准备 facts 格式升级。所有 `apply` 必须转到 manager；复制、移动、路径变更或 before-state 漂移时重新检查并创建新计划，不重放旧计划。

## 3. Facts、验证与管理中心

受众：开发者和产品维护者。

```sh
./foundation-kit status
./foundation-kit status /absolute/path/to/product
./foundation-kit verify /absolute/path/to/product
./foundation-kit inventory /absolute/path/to/product
./foundation-kit center /absolute/path/to/product --port 4317
./foundation-kit classify-change --input /absolute/path/to/change.json
```

`status`、`verify`、`inventory` 和 `classify-change` 读取 manifest、项目 facts 或明确输入；`verify` 失败时返回非零码和具体文件/字段。`center` 启动 loopback 管理中心；页面关系写入仍需项目 authority 与 manager confirmation。生成 HTML 是展示层，不能覆盖 `.foundation/facts`。

## 4. Capability 与 extension 生命周期

受众：Foundation 维护者。读取已打包 capability manifest、安装登记、项目 authority 或组件 registry；确认后可能写 capability/extension 状态或项目拥有的组件文件。

```sh
./foundation-kit capability audit --manifest /absolute/path/to/capability.json
./foundation-kit capability status --manifest /absolute/path/to/capability.json --root <installation-root> --project /absolute/path/to/product
./foundation-kit capability install plan --manifest /absolute/path/to/capability.json --root <installation-root>
./foundation-kit capability register plan --manifest /absolute/path/to/capability.json --root <installation-root>
./foundation-kit capability activate plan --manifest /absolute/path/to/capability.json --root <installation-root> --project /absolute/path/to/product
./foundation-kit capability deactivate plan --manifest /absolute/path/to/capability.json --root <installation-root> --project /absolute/path/to/product
./foundation-kit capability uninstall plan --manifest /absolute/path/to/capability.json --root <installation-root>
./foundation-kit extension list
./foundation-kit extension detect --adapter shadcn --project /absolute/path/to/product
./foundation-kit extension plan --adapter shadcn --project /absolute/path/to/product --root <installation-root>
```

plan 阶段不执行 effect；`capability ... apply`、`extension apply`、`extension remove` 与旧 `install-skill` 直写入口均被拒绝。状态显示 identity、registration 或 project predicate 不一致时，先修复相应 authority，不要通过参数注入 registration 或路径。

030R1 能力中断恢复仅走 `manager request-plan --operation capability-recover --parameters-json '{"installationRoot":"<实际安装根>"}'`，然后打开返回 planRef 的 manager，由用户确认。它要求可验证的写前日志和已退出进程；未知或用户修改的内容不覆盖。没有 `manager recover` 或 `capability recover apply` 直写命令。

## 5. Manager、源码开发与 sandbox-only

受众：可信宿主集成和 Foundation 开发者。

```sh
./foundation-kit manager inspect
./foundation-kit manager request-plan --operation install --parameters-json '{}'
./foundation-kit manager open-manager --plan-ref <opaque-plan-ref>
./foundation-kit manager status --plan-ref <opaque-plan-ref>
./foundation-kit setup
npm run candidate
npm run preview
```

manager 只接受 inspect/request-plan/open-manager/status；不存在 confirm/apply/recover/purge 命令。`open-manager` 只接受 opaque `--plan-ref`，不接受 root/path/action/port。`setup` 仅检查 Node.js，`npm run candidate` 与 lifecycle 的 root/sandbox 参数仅用于源码和隔离验收。

AI-facing surface 也只有：

```text
Foundation:inspect
Foundation:request-plan
Foundation:open-manager
Foundation:status
```

这四个工具可以读取、准备计划、打开确认界面和读取状态；它们不能自行确认或执行 mutation。

## 生命周期结果恢复（031 起的现行运行能力）

`manager open-manager` 返回 URL、planRef、sessionId 和记录位置，随后可输出同次 `FOUNDATION_OPERATION_RESULT`，不以进程退出作为普通维护完成条件。页面本人确认，AI 不代提交。

同次查询使用 `manager status --plan-ref <原返回值>`；首次安装使用 `onboarding status --session-id <原返回值>`。它们只读、不重放操作；中断且无终态时需核实，不能宣称成功。卸载后若 launcher 已移除，只读核对原安装根 `uninstall-result.json` 和先前记录的操作/安装身份，不自动补做 mutation。临时页面失效后，按已记录路径恢复，不承诺网页唤醒对话。
