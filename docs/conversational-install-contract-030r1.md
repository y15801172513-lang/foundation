# Codex 对话安装契约 030R1

状态：`IMPLEMENTATION_IN_PROGRESS`。尚无已发布、可从 GitHub 获取的安装入口；不要把以下接口或本地 candidate 当作真实用户验收。

用户体验固定为：复制 GitHub 安装指令 → Codex 检查并解释 → 对话选择版本/目录 → Codex 内置浏览器展示同一 exact plan → 用户在页面确认 → 程序执行 → 对话查询结果。不是独立安装向导，不制作用户手动安装的 DMG/PKG/App。

## 当前最小范围（取代下文早期独立签名路线）

面向两位主要使用者，先完成 macOS 私有闭环；公开只是随后允许别人获取。当前主路径不创建或使用独立发行密钥，不建设签名服务、自动更新、多渠道或 Windows 分发。既有 Ed25519 代码保留但后置，不是本轮发布前置条件。

获取信任采用固定 GitHub 仓库 ID/名称、精确版本 tag 与 commit、不可变 Release、资产大小/SHA-256，以及 GitHub 自带 `gh release verify-asset` 证明。入口仅在这些检查通过后展开和执行；校验失败不跳过。构建命令为 `scripts/build-conversational-entry.mjs --github-catalog <版本清单> --output <新 .tmp .sh>`，无私钥。清单的 `keyId` 为 null，不能自行更换产品固定仓库；入口自身仍须来自已批准的不可变契约 revision，JSON 文件本身不证明来源可信。

Release 中的运行文件可为未做独立开发者代码签名的 clean-commit 构建；保持 `signature.status=unsigned`，不伪装 `verified-distribution`。获取入口核验的是该文件确为固定 GitHub Release 资产，并绑定 candidateHash、官方 Runtime 和源码 commit；这与安装程序内的文件清单校验、manager 确认分别负责不同边界。GitHub 来源核验不等于 Apple 公证，系统安全提示仍需实际机器验证，不关闭 Gatekeeper 或移除隔离属性。

该方案信任受控 GitHub 仓库及 GitHub 平台，能识别错误版本、下载损坏、资产替换与已发布 tag 漂移；不保证发布前未遭账户入侵、不保证源码无漏洞。对当前范围不以独立密钥增加长期保管负担。若实际私有仓库不能提供不可变 Release 证明，先报告具体平台限制，再评估最小替代，不能默默降低校验。

当前必须完成：上述入口正常获取、目录选择/安装/重开、Skill 新任务可用、精确项目的小任务、手动升级恢复卸载和事实保留；真实目录/项目动作仍独立确认。自动缓存清理界面后置，当前披露并保留缓存、不删除未知内容。首次公开仓库、Windows、规模化服务均不阻挡私有 macOS 工程收尾。

## 当前接口与发行检查状态

旧独立签名模式为 deferred 实验；构建 CLI 拒绝 `--catalog`，不自动回退。当前仅使用 `--github-catalog`，不依赖独立产品密钥。

本地安装健康、清单版本、远端查询/获取和独立签名分别报告。`onboarding inspect` 不查远端，版本列表为空、远端为 `not-checked`、发布为 `unknown`；unsigned 不是未发布证据。已有安装需从 installed authority 核验，不从候选或完成记录推断健康。

生成入口的 `--inspect` 不依赖 Node；版本、架构和归档身份来自对应可信 GitHub 入口清单，远端仍为 `not-checked`。结构验证不证明清单来源或远端已发布。最终文件只用版本化 GitHub Release，Actions 仅构建/验证。

已实现的宿主适配为 `--github-client <宿主核验过的 gh 实路径>`：由 Codex 使用已有登录会话，核对固定 repository ID、tag 对应的精确 commit、非草稿/非预发行/immutable 状态、唯一资产名称、长度、SHA-256，再下载精确资产。客户端不从 PATH 查找，不安装、不复制进 Runtime；凭证不作为参数、URL 或输出。宿主缺少已认证客户端时明确阻断，不要求用户下载归档。目前没有可用的 Release 二进制下载连接器替代方案，不声称所有 Codex 主机都具备此能力。

下载只写独占缓存。仓库/tag/资产元数据、长度/SHA-256、GitHub 证明、官方 Runtime 和 candidate commit 绑定全部通过后，才输出 `GITHUB_ACQUISITION_VERIFIED`，绑定版本/commit/资产摘要，再转交 candidate 完整校验与 manager 确认。该事件仅描述当次操作，不被 inspect 当成权限或可信收据；不接受调用方布尔证明。失败非零退出且不输出成功事件。当前 GitHub 路径拒绝 `--archive`，不回退来源；真实 Release 获取仍未验收。

清单绑定 repository ID、source commit、版本和内容寻址资产；不允许 latest、分支名替代 commit、临时 URL 或自行任命信任根。旧独立签名和通用 HTTPS 实验退出当前操作指导，共享校验与有效负例保留。

该入口会在 OS account 的 `Library/Caches/ai-product-foundation-kit-acquisition` 创建 0700 获取缓存，具体本次目录在准备时显示，并记录不含凭证的 `acquisition.json`（版本、仓库/提交和预期资产身份）。成功、失败及卸载后均保留，不自动清除或修改权限；此记录是识别线索，不是删除授权。获取缓存不是用户选定的安装根，不承诺系统其他位置零文件。自动清理接口尚未提供，后续如需清理须核对精确目录和实际内容并单独授权；不得据识别文件递归删除未知内容。源码建设目录直接执行生成入口会在创建账户缓存前拒绝；`--inspect` 仍可只读使用。不得管道执行未知远程脚本，入口本身必须由获准的不可变产品契约版本取得。

| 产品接口 | 输出/边界 |
| --- | --- |
| `onboarding inspect [--destination <absolute-directory>]` | 只读 OS/架构、默认与建议目录、空间、已有内容、Skill 预期位置及阻断；没有发行清单时版本列表为空 |
| candidate `install [--destination <absolute-directory>] [--browser codex]` | 目录意向进入现有不可变计划；`codex` 模式返回 loopback URL，不打开系统浏览器、不批准 |
| `onboarding status --session-id <operation-session>` | 只读活动/终态记录；清理后可能 not-found；完成记录不是 installed health 证明 |
| installed `onboarding open --root <installed-root>` | 打开只读真实安装概要；不依赖开发预览，不以示例项目伪装空状态 |
| 已有 `manager inspect/request-plan/open-manager/status` | 原确认、身份、期限和单次消费约束保持；AI 无 apply/confirm 工具 |

这些是产品开发接口，不要求普通用户手写内部参数。模型应从真实返回值解释，不编造可选版本、已注册 Skill 或健康状态。聊天里的“好”不触发 apply。

自选目录目前要求其父目录已存在、可验证且不是符号链接；不允许文件系统根目录、符号链接祖先或非目录祖先。默认仍从 OS account 派生。bootstrap manager 会在用户缓存目录保存锁、计划和终态，故自选目录不代表其他系统位置零文件。尚未完成自选根全生命周期/发现记录验收，不能承诺重复调用默认入口会发现任意位置的旧安装。

只读检查现可读取已接入 Skill 的 `foundation-installation.json` 提出自选根；没有 Skill 线索时使用默认目录或再次询问用户，不扫描主目录。线索拒绝未知字段、符号链接、不同所有者和已消失目标；不执行内容、不授予写入权，也不把它称为安装已验证。已有非空根若当前只读 authority 不能核验，返回明确的 existingInstallationCheck，不能覆盖；正常 candidate install 的已有安装分支先核验 current/index/receipt 及 runtime/shim/app 字节，再转交 installed inspect，不创建第二套安装。真实迁移仍需独立计划。

## Runtime 与获取信任

`packages/core/official-node-runtime.mjs` 固定 Node 24.14.1 macOS arm64/x64 的官方归档 SHA-256；构建器可用 `--runtime-archive` 校验归档后读取固定 `bin/node` 与 `LICENSE`，在 payload 保存来源记录。普通用户无需 Node/npm；本地源码构建仍需开发依赖。

来源证明范围为官方 HTTPS 清单与固定归档摘要，不等于 OpenPGP 验证，也不等于 Foundation 的发行签名、公证或用户机器验收。保留 local-development 与 verified-distribution 的区别。

`packages/core/release-catalog.mjs` 保留 GitHub 固定来源、有效期、唯一版本/架构、URL、Runtime 和摘要校验。混合旧签名分支暂缓；当前下载由入口调用 gh，不使用通用 HTTPS 实验。

当前仍需新提交的发行文件、独立发布授权和真实 GitHub/宿主/安装验收，本地模板及隔离测试不替代这些事实。

候选验证另支持 `distribution-signature.json`，以产品固定策略中的 Ed25519 公钥验证精确 candidateHash，再核验完整 payload。候选不能携带自己的信任根。该产品策略当前为空，`verified-distribution` 仍拒绝；未使用未知签名身份。签名检验单元测试的临时密钥仅为工程夹具。

## Skill 独立接入与停用

安装后的 `capability-register` 精确计划可选择 `connectCodex: true`，向 OS account 的 `.agents/skills/ai-product-foundation-kit` 写入最小 Skill 与安装位置线索。页面披露父目录和文件创建；同名非空内容拒绝覆盖，源码 authority 拒绝宿主写入。该线索必须在每次任务中经 installed launcher 核验 current，不能固定旧版本。

对应 `capability-uninstall` 单独展示删除范围，只删除已签名记录且未改的文件；目录、未知内容、用户修改保留。Foundation 卸载前要求先处理已有 Skill 归属记录。隔离工程注册/停用及下列崩溃场景已通过；尚未真实用户注册，不能宣称 Codex 已发现/调用。

新增 `manager request-plan --operation capability-recover --parameters-json <installationRoot 对象>`，仅生成新的精确恢复计划，不是 AI 直写入口。030R1 写前日志保存确切 before/after 内容并签名；进程退出可验证、文件仍匹配日志且无其他事务时，恢复回滚未完成操作，或只收尾已完成操作。未知/修改内容、缺少写前证据的旧事务保持 fail-closed；不删除残留目录或不完整临时文件。恢复操作自身也需要新的 manager 确认。该实现仍在工程复测，不能宣称崩溃场景已经全部通过。

已完成的隔离复测包括 Skill 登记首文件后进程中断、恢复本身再次中断、停用删除后中断、用户改动导致恢复拒绝。两版本维护和重装后独立接回项目的事实保留也已通过工程演练。这些不等于真实宿主发现、任意断电点全部覆盖或 Joseph 的维护验收。

## 最短用户操作卡（未发布，当前不可开始验收）

发布后 README 的复制指令应为：“请按本仓库的 Foundation 对话安装契约，检查我的环境并安装 Foundation；让我选择版本和位置，在 Codex 内置浏览器展示精确计划，由我确认后执行。”本次没有可用的发布页面或安装链接，不能让新任务仅凭这段文字读源码现编安装步骤。

正常对话只询问缺失的版本/目录选择；不存在的版本不提供，已有内容不覆盖。页面须显示最终实际目录、版本、所有影响位置、运行时来源与项目零自动启用。安装健康验证通过后，另行选择是否接入用户级 Skill，再选择精确项目并确认项目计划。之后可说“打开这个项目的 Foundation 管理中心”，但前提是宿主已实际发现 Skill，且 installed current 和 project binding 均有效。

网络、校验或权限失败时不换来源、不复用批准；保留错误码，重新检查同一可信入口。计划到期、目标变化或恢复操作均需新计划和页面确认。新任务未发现 Skill 时按宿主支持的刷新/新任务流程核验，不手写注册状态，也不承诺任意空白任务会自动发现 Foundation。

## Codex 宿主事实（2026-09-08 核对）

- 官方 [Skill 文档](https://learn.chatgpt.com/docs/build-skills) 描述用户级 `.agents/skills` 与仓库级发现位置、自动检测和未出现时重启；实际新任务可见/调用必须独立验证。仅复制 artifact 或 Foundation 内部 registration 不证明宿主已发现。
- 官方 [Browser 文档](https://learn.chatgpt.com/docs/browser) 为宿主浏览器能力依据；当前任务可用的浏览器打开工具支持 loopback URL。产品仅返回 URL，不虚构宿主注册或页面批准 API。
- Node 官方 [发行与校验说明](https://github.com/nodejs/node#verifying-binaries) 区分 SHA-256 与签名校验。
- Apple [公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) 并不要求唯一使用 DMG；命令行/归档交付仍应按实际代码签名、公证和下载隔离条件验证。不得关闭 Gatekeeper 或清除隔离属性。

## 当前试用门（按最新收束，不穷举潜在场景）

1. 工程：必要修复的定向验证与 macOS 构建；不再以新一轮全量潜在场景、缓存界面、Windows 或独立签名作为试用前置。已有隔离 Skill/项目/维护证据不替代真实宿主操作。
2. 保存与发布：先批准精确本地保存内容，得到真实新 commit 后构建最终资产，再集中批准对应私有仓库 push/Release/资产操作；不得编造尚未生成的 SHA 或安装链接，不要求独立签名身份。
3. 用户：新任务从已可访问 GitHub 指令开始，Joseph 自己确认安装和项目接入；真实目录/全局 Skill 写入另授权。
4. 维护与独立复核：两版本升级/回退、repair、停用、卸载/重装及保留事实；破坏性真实操作另确认。

## 已确认的私有到公开流程

先在现有私有仓库完成获取、安装、Skill 新任务发现、首次项目使用和维护卸载的实际验收；通过后才另建独立公开仓库。禁止将现有私有源码仓库改成 public。日常迭代仅在私有仓库，发布时先保存并验证精确私有版本，再依公开导出合同审查源码快照与发行资产，建立两边版本对应；不要求内容或 Git 历史相同，不公开私有报告、本机信息、凭证或私有历史。

渠道确认不授权 Git/Release/资产上传/真实安装。操作前须集中列出精确仓库身份、commit、版本、文件名/长度/摘要和操作范围；尚未产生的 commit 不编造 SHA。获准的 GitHub 写入使用 Mono，并核验远端结果。公开仓库身份、许可证和公开范围仍是独立门。
