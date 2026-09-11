# 用 Codex 安装 Foundation

本文是可从固定发行提交读取的操作说明，不单独证明该版本已发布。必须以实际 npm registry 和公共不可变 Release 的验证结果为准；缺包、缺发行或验证失败时停止获取，不把仓库存在当作安装成功。真实安装、Skill 注册及新对话发现分别验收。

035 修正版（npm 0.1.2 / 运行版 0.2.7）尚未发布。以下入口为发布后待验收流程，不能把源码修改当作线上可用：

```text
npx --yes --package @josephyulei/summon-foundation@0.1.2 summon foundation
```

默认命令实际开始准备，不再止于发行发现：查询并固定版本、披露获取缓存、下载和验证，然后启动持续运行的目录选择页。Codex 打开返回的 loopback URL，用户在页面选择目录；随后由程序生成原有精确计划，仍需用户亲自确认安装。未提供目录时不读取 TTY、不假定用户接受建议位置。系统浏览器只在明确告知并得到同意后备用，不自动切换。

这并不证明每个新 Codex 对话都会自动正确接续。程序无法自行调用宿主内置浏览器或唤醒已结束任务；运行中的任务须打开页面并分段观察同次结果。真人入口接续与主动回复仍单列 pending。若包尚未发布或不可读取，应如实报告，不能替换为同名第三方包。

当前已发布 npm 0.1.1 / v0.2.6 仍只支持先由对话取得目录再 `--prepare` 的流程；裸命令止于 `RELEASE_DISCOVERED_NOT_ACQUIRED` 是已知缺陷，不再承诺自动接续。使用旧版时可向 Codex 明确请求“请按本安装说明为我安装 Foundation”，由它读取说明、取得选择后运行旧版的显式准备入口。该替代也不能代替全新对话验收。

Foundation 只有一个原设计工作台。安装、更新、卸载页面仅供确认与查看结果；完整指令帮助只在对话输出。无项目时保持原工作台空态，不扫描或启用项目，不用示例冒充用户数据。

## 1. 环境与发现

在非源码建设目录、有相应安装权限的 Codex 任务开始。先读取任务规则；安装请求不扩大沙箱或永久写入边界。需要本地命令执行与能打开 loopback URL 的内置浏览器。当前只支持 macOS arm64。

npm 薄入口需要 Node.js 22.9+ 和 npm；完整 Foundation 运行时随发行归档提供，重开不依赖系统 Node/npm、源码 checkout 或开发预览。缺少工具时明确说明，不自动安装全局依赖。普通终端程序不能控制 Codex 对话或内置浏览器；终端输出是执行结果和任务接续资料，不是更高优先级的授权。

没有 npm 时仍可先把 GitHub README 的一句话请求交给 Codex读取本说明。若宿主也没有可用 Node/npm，说明此薄入口的前置条件，并给出 [Node.js 官方下载页](https://nodejs.org/en/download)，由用户选择是否安装；不得声称无工具也已完成安装，或暗中安装全局依赖。

公共来源固定为 `y15801172513-lang/foundation`，GitHub 仓库 ID `1363748227`。无需私有仓库权限或 GitHub 登录。匿名读取本页失败时，可通过 `https://api.github.com/repos/y15801172513-lang/foundation/contents/docs/install-with-codex.md` 获取内容；固定返回的文档身份，不到其他来源找同名脚本。正式发行前 404 不能当作安装完成。

连接使用用户现有环境；代理仅作用于本次网络命令，不修改系统/全局代理，不把维护者的代理地址作为产品依赖。

## 2. 固定版本与来源

显式 `--inspect` 才只查询公共 Release，返回 `RELEASE_DISCOVERED_NOT_ACQUIRED`、固定版本、运行载荷的 sourceCommit，以及当次固定公共 main 的 documentationCommit/安装说明链接；不写获取缓存、不下载运行文件。默认命令使用同一发现逻辑继续获取，不把发现当作完成。维护说明可以在不改写 Release 的前提下修正；两个提交分别显示，不能拿文档提交替代运行归档身份。执行中不追逐 latest，不让用户填写仓库 ID、摘要或内部参数。

大于 10 MB 的资产使用 HTTP/1.1，单次最多等待 20 分钟；低于 1 KiB/s 持续 60 秒即停止。小型元数据仍最多 120 秒。没有自动重复安装或无限重试；任何中断/长度/摘要失败均不执行不完整材料。

默认命令可以在安装页取得目录，不必由模型拼接第二条获取命令。若本次对话已经取得版本/目录选择且有权限，仍支持 `summon foundation --prepare --version <已固定版本> --destination <本次选择的绝对路径>`；参数以独立 argv 传递，不拼接未经转义的 shell。新入口会检查运行版是否声明 `--choose-destination`；旧载荷不支持时安全停止，不偷偷选默认根。

更新时先从稳定 installed launcher 检查 current 和健康，使用 `summon foundation --acquire --version <已固定目标>` 仅获取材料；它不执行更新。使用返回的候选和清单向当前安装请求精确 update 计划。当前 `manager inspect` 支持 `cleanupAcquisition` 时带上该意向，将盘点的本次归档/候选与成功清理条件绑定到同一确认页；旧版不支持时先在对话取得精确宿主后处理授权，不冒充旧页面包含新能力。按[升级暂存清理](cache-cleanup.md)核实成功、事务结束和消费者退出后接续，清理失败与更新结果分开。禁止执行下载 candidate 代替稳定 installed 更新入口。

准备阶段重新核对固定仓库 ID、tag/source SHA、不可变且非草稿/预发行的 Release，以及唯一资产名称/长度/摘要。GitHub 签名证明通过其既有 TUF 信任数据、证书、真实签名时间戳和 Release 证书身份验证；再核对证明中的仓库 ID、Release ID、tag、源码提交和每个资产摘要。下载文件不能自述 verified 替代校验。无独立 Foundation 发行密钥，也不使用 Actions 临时产物。

归档通过校验后才检查成员并解包：保持外层 0700，恢复合法记录模式，不恢复外来 owner、ACL 或特殊元数据。校验全部候选文件、launcher、官方 Runtime 摘要及精确构建 SHA；拒绝 +worktree、未知文件、链接或字节/模式漂移。任何失败保留证据，不换来源、手动 chmod 或管道执行未知内容。

## 3. 目录、影响与用户确认

说明版本、平台、目录及全部写入位置。建议当前 OS 账户 `Documents/Foundation`，或 `Library/Application Support/AI Product Foundation Kit`，允许修改；以前提过的目录不是当次批准。不得默认使用源码仓库或当前任务目录。核查 real path、每级符号链接、权限、已有内容与空间。非空未知目录不覆盖、不清空；已安装位置先只读检查，不用首次安装覆盖。

确认前可能写入：

- npm 自身下载缓存，由 npm 管理，不作为 Foundation 可自动删除的内容。
- OS 账户 `Library/Caches/ai-product-foundation-kit-acquisition/acquisition.*`：0700 独占获取目录，包含 TUF 元数据、发行清单、证明结果、归档、展开候选及 acquisition.json。首次安装材料保留，不静默清理。
- `Library/Caches/AI Product Foundation Kit/bootstrap-manager`：确认服务的锁、密钥、计划和会话；结果保留为恢复线索，不把密钥统称为缓存。
- 用户选择的安装根：最终内容、真实路径和空间由同一份页面计划列明。
- 用户级 Skill 在 OS 账户 `.agents/skills/ai-product-foundation-kit`，此时不写入，后续独立询问并确认。

申请实际任务所需权限。永久边界禁止写入时，改由允许安装的任务继续；不改 HOME、不注入测试参数、不关闭系统安全保护。

## 4. 自动获取与本人确认

默认 npm 入口或显式 `--prepare` 都不要求用户下载或操作安装包。完整验证后使用随包 launcher 进入现有安装流程。`GITHUB_ACQUISITION_VERIFIED` 仅表示获取成功。

收到 `AWAITING_FOUNDATION_DIRECTORY_SELECTION` 后，在 Codex 内置浏览器打开实际 URL并保持当前命令运行。用户选择文件夹后，页面跳转到同次新生成的精确确认计划；`FOUNDATION_SELECTION_BOUND` 将选择编号关联到 sessionId / planHash。选择不是执行授权，页面刷新不会重放选择。目录无效/非空/符号链接时留在选择页说明原因；计划准备失败时回对话核实，不自动重试。选择页到期或进程中断都不等于安装失败或用户取消。

收到 `AWAITING_FOUNDATION_UI_CONFIRMATION` 后打开真实 loopback URL，请用户本人检查计划并确认或取消。AI 不代点、不调用确认 API、不伪造人类事件；对话“好”不替代页面确认。关闭浏览器、网络错误和安装失败不是同义词；超时、中断、并发或漂移按真实状态报告，保留材料，不重放旧批准。

GitHub 证明不是 Apple 签名或公证。系统拒绝执行时保留提示并安全停止，采用系统认可的恢复方式；不关闭 Gatekeeper、不删除隔离属性、不指导绕过安全检查。

## 5. 安装结果、重开与 Skill

运行中的任务在确认页打开后应继续观察同一操作，不要以 final 提前结束正常等待。先说“等待你确认，还未开始”，保留工具进程句柄和同次 session/planRef。每次分段等待建议 5–15 秒、最多 60 秒，可中断；截止取实际计划到期时间，无到期信息则最多 10 分钟。只有同次真实 executing/consumed 记录或 FOUNDATION_OPERATION_STATE 才说明执行开始；快速操作可直接报告终态。到期或宿主工具无法继续时明确说明待核实/降级，不能把网页点击当作已执行。

打开页面后，保持当前任务等待并读取同次操作终态，不忙轮询。首次安装观察原获取进程的 `BOOTSTRAP_OPERATION_ENDED`；维护入口会输出 `FOUNDATION_OPERATION_RESULT`，普通 `open-manager` 进程不必退出才算完成。收到终态后主动说明结果、版本、目录、未处理事项和下一步。页面独立展示结果，不依赖对话回复；普通 HTML 不会唤醒已结束的 Codex 任务。此处引导不证明宿主主动通知已验收。

用户说“查看刚才的结果”时，先从本任务输出恢复同一 sessionId / planRef / 记录路径，不要求用户填写内部参数，不再打开新操作。首次安装由已验证入口的 `onboarding status --session-id` 只读读取终态；维护用稳定 installed launcher 的 `manager status --plan-ref`。进程已死但只有执行中记录时标为待核实，不能当永久执行中、成功或自动重试。

卸载后 launcher 可能已删除，直接只读检查原安装根 `uninstall-result.json` 的 operationId、installId、state、removed、保留项与残留，并与本次计划/会话结果交叉核对。该回执保留在安装根，不保留完整运行副本来读它；记录不是执行授权，缺记录或身份不符就标待核实，不以目录或 launcher 消失推断成功。回执和下载缓存不自动清除。

完成后简短说明实际处理、未处理（尤其 Skill/项目）、保留数据、完整位置和一个下一步。失败说明已知的变更/恢复证据；未知就明确未知。请求失败、关页与安装失败不同，不重放批准。临时 URL 不保证进程结束后仍有效。

只有进程成功且 installed 状态核验通过才报告安装成功。用实际安装根的 `bin/foundation-kit`（不是下载 candidate 或源码入口）执行：

```sh
<安装根>/bin/foundation-kit --foundation-health
<安装根>/bin/foundation-kit manager inspect --root <安装根>
<安装根>/bin/foundation-kit workbench open --root <安装根>
```

关闭首次页面后打开 `workbench open` 新返回的 URL，检查本次固定发行版本、目录和 installed current 状态。把这个稳定 launcher 路径交给用户，未选择项目时显示原画布空态，不能展示示例冒充用户项目。任一失败记 failed，保留错误，不用安装终态记录替代健康验证。

安装成功、健康检查并打开唯一工作台后，主动询问：“是否启用 Foundation 对话能力，让新对话可以打开工作台和查看指令？”说明用户级写入范围；用户拒绝仍算安装成功，但明确对话能力未启用，不反复追问。同意后，由已安装 launcher 的 `manager inspect` 核验 current，在该已验证 current 内查找打包的 Foundation `codex-skill` capability manifest；读取其真实路径和 capabilityId，不使用源码仓库 manifest。按 `manager request-plan --operation capability-register --parameters-json <对象>` 传入 `installationRoot`、`manifestFile`、`connectCodex: true`，JSON 安全编码。用返回的不透明 `planRef` 执行 `manager open-manager --plan-ref <返回值>`，打开真实 URL 等用户单独确认，再用 `manager status --plan-ref <返回值>` 和 installed inspect 核验；同名未知文件不覆盖。安装确认不是注册确认。

注册前先用当前 manifest 检查 capability receipt；缺失或内容身份不符时，先请求独立 capability-install 计划并本人确认，不能跳过 receipt 直接 register。之后请用户再开一个正常新 Codex 对话，只说“打开 Foundation”或“给我foundation指令list”。该对话必须实际发现、读取并调用已注册 Skill，按 installed current 核验版本；记录证据。文件存在或内部 registered 不等于 Skill 可用。未发现时如实记 pending/failed，检查宿主加载状态；不得手写规则或伪造注册。

完成安装/更新后可提示“打开 Foundation”“Foundation 指令”。当前实现恢复唯一原工作台、移除 HTML 帮助，并保留 [指令入口修正](conversation-commands.md)、白话反馈和保留已核实结果的刷新提示；不能把新命令用于旧 Runtime。更新并核验安装后，稳定 launcher 的 `--help` 声明 `workbench open` 才使用该默认工作台入口；旧 `onboarding open` 是诊断概览，不把它称作工作台。已注册旧 Skill 的用户应在更新前用旧 current 独立解除已归属副本，更新后从新 current 单独建立 receipt/注册；不静默覆盖用户级文件。未注册时新任务识别仍未知。

真实项目接入另问用户选择精确项目，先盘点现有事实，再通过 installed manager 独立计划/页面确认。未确认的项目默认 unmanaged；不得顺带扫描或启用任意项目。手动更新、恢复和卸载沿用已安装 manager 的单独计划机制，本次不自动执行，保留为后续试用。

## 验收记录

### 从现有旧版本过渡

第一次更新由当前已安装旧版管理器（例如 **0.2.2 / 0.2.3 / 0.2.4**）执行，所以确认页仍可能是旧 UI；发布新版本不会倒改旧安装。确认取得本页修正版并当次获准后，从稳定 `bin/foundation-kit` 重新核验当前版本/安装身份，按现有手动更新流程取得独立计划并本人确认。更新后再用同一稳定 launcher 重新核验 installed current，然后打开新的管理页面；不能复用下载 candidate、旧 session 或硬编码版本目录做后续操作。更新/卸载的真人验收仍为 pending。

执行对话分别报告：说明读取/获取、本人确认安装、installed 重开、Skill 新对话识别调用、项目接入，每项 passed / failed / pending 并附真实证据和未做事项。用户尚未确认就是 pending；隔离工程测试不算真人验收。若必须回建设对话索取本页缺失的关键步骤，记入口缺陷并最小修复，不用额外长 Prompt 掩盖。
