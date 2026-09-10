# AI Product Foundation Kit

v0.2.6 已作为独立公共发行发布，保留用户确认的唯一 Foundation 工作台与仅在对话输出的指令帮助。旧私有发行保持不变；已安装副本须经本人确认更新后才获得新能力。

页面越做越多，仍能说清它由什么组成、和哪里有关，以及这次到底要改哪一处。

AI Product Foundation Kit 把项目中已经记录的页面、组件、关系、交互、资产与变更事实，和接入预览返回的对象上下文，组织成一个本地工作台。它帮助正在用 AI 做产品的人先把对象和影响范围说清楚，再提出更具体的修改任务。

> 当前仅面向 macOS arm64。[公共 v0.2.6](https://github.com/y15801172513-lang/foundation/releases/tag/v0.2.6) 已发布并完成 GitHub 来源证明核验。npm 0.1.0 已发布且只读发现通过；慢速链路的大归档获取仍在复验，0.1.1 下载修正准备中。工程验证不代替真人安装、Skill 发现及项目接入验收。

## 用 Codex 安装

在具备安装目录写权限、不属于源码建设目录的 Codex 对话中发：

```text
请按照 https://github.com/y15801172513-lang/foundation/blob/main/docs/install-with-codex.md 为我安装 Foundation。
```

Codex 按[安装说明](docs/install-with-codex.md)查询正式 [GitHub Release](https://github.com/y15801172513-lang/foundation/releases)，固定单次版本、核验来源与文件，再说明环境、目录和写入影响，在内置浏览器展示计划，等你亲自确认。无需 clone 源码或手动操作安装包。npm 薄入口需要 Node/npm（Node ≥22.9）；已安装 Foundation 使用随包运行时。缺工具或权限时先说明，不自动全局安装依赖。公共入口不要求访问开发仓库。

安装后主动询问是否启用 Foundation 对话能力；Skill 注册和项目接入分别确认，不静默捆绑。完整指令帮助只在对话输出。无程序/Skill时的残留处理见[缓存清理说明](docs/cache-cleanup.md)，不依赖已删除 launcher。

运行文件只从正式版本化 GitHub Release 获取，Actions 临时产物不是最终下载源。公开仓库是审核后的独立快照；日常开发在私有仓库，公开内容不包含内部报告、本机信息或私有历史。采用 GitHub 自带来源证明与摘要校验，不另建发行密钥体系。尚无 Apple Developer ID 签名/公证，不绕过系统安全检查。手动更新、恢复和安全卸载保留，自动更新和 Windows 后置。

## 你是不是也遇到这些问题

| 遇到的情况 | Foundation 当前能提供什么 | 边界 |
|---|---|---|
| 页面结构越来越复杂，找不到要改的那一块 | 在已接入的预览中检查对象，看到所在页面、稳定身份、完整层级，以及它是已登记组件还是普通局部结构 | 不会自动理解任意应用或未接入的网站；没有返回或登记的事实仍是未知 |
| 不清楚页面如何跳转、什么会触发状态变化 | 查看已登记的页面关系、进入与去向、触发条件、目标状态及验证状态 | 关系登记与运行时绑定是两件事；不会声称发现了全部业务逻辑 |
| 只能对 AI 说“左边那块”，反复解释仍改错 | 从选中对象复制“身份与层级”“相关逻辑”“布局与样式”或“使用、影响与缺口”，再补上具体修改目标 | 生成的是更具体的任务上下文，不保证 AI 一定理解正确或自动完成修改 |
| 一个组件用在多处，不知道改了会影响哪里 | 查看已登记组件或资产的已知使用页面、实例和相关变更，并区分修改组件资产还是当前实例 | 已知使用位置不是全部传递依赖的证明，仍需结合代码与验证复核 |
| 换一次对话就丢掉项目背景 | 把页面、组件、关系、交互、资产和变更等长期事实保存在项目自己的 `.foundation/facts/` | facts 不会凭空保持完整或永远最新；缺失、待确认和冲突会继续显示为缺口 |

## 一次具体的使用方式

下面是一段基于仓库示例 `examples/foundation-events` 的说明性流程；修改要求只是示例，本轮没有执行这次产品修改。

1. 打开开发预览，在 Foundation 工作台中进入一个包含 EventCard 的页面。
2. 使用“检查对象”选择 EventCard。侧栏会显示它的页面位置、对象层级、组件身份和已知使用位置。
3. 按任务需要复制“身份与层级”或“完整对象上下文”，再补一句具体目标，例如：“只调整当前 EventCard 的次要信息间距，不改变其他页面上的 EventCard。”
4. 查看“相关逻辑”和“使用、影响与缺口”，确认哪些页面关系来自已登记 facts，哪些使用位置已知，哪些信息仍待确认。
5. 把这份上下文交给 AI 或开发者，在真正修改前再次核对代码范围和受影响的已登记使用位置。

这里的“相关逻辑”只由当前对象所在页面的已登记关系，加上触发词与对象名称的匹配得出。它是任务线索，不是完整因果分析。

## 今天可以了解和尝试什么

### 检查页面和对象

本地工作台把页面预览与“页面逻辑”“检查对象”放在同一处。已接入预览可以返回对象稳定身份、角色、组件或实例身份、祖先层级，以及有限的布局和样式摘要；普通页面结构也可以被定位，而不会被伪装成缺失组件。

### 查看已登记的关系和状态变化

“信息与逻辑”画布展示已经登记的页面节点和关系，区分关系草稿、已登记、已验证，以及触发器未绑定、待绑定、已绑定或运行跳转已验证。保存一条关系只会更新关系事实，不会自动实现产品里的运行跳转。

### 准备更具体的任务上下文

对象复制分为“完整对象上下文”“身份与层级”“相关逻辑”“布局与样式”“使用、影响与缺口”。输出包含项目、页面、对象和 facts 版本线索，并给出“建议修改组件资产”或“建议只修改当前位置”的范围提示。它帮助减少含糊描述，但修改者仍需验证代码、运行结果和未登记影响。

### 保存项目自己的长期事实

项目启用后，`.foundation/facts/*.json` 是页面、组件、关系、交互、资产和变更等长期事实的权威来源。安装 Foundation 不会自动扫描、启用或修改产品项目；每个项目保持 `unmanaged`、`enabled`、`disabled` 的显式状态。普通停用或卸载保留项目源码、身份和 facts；永久删除是另一项需要单独确认的破坏性操作。

## 运行本地开发预览

要求 Node.js `>=20.19.0`。从仓库根运行：

```sh
npm ci
npm run preview
```

预览固定使用 `http://127.0.0.1:4317/`，并在 Foundation 工作台中承载仓库内的 `examples/foundation-events`。它不会安装 Foundation，也不会启用真实产品项目。

查看状态或停止：

```sh
npm run preview:status
npm run preview:stop
```

第一次浏览开发预览建议按[入门指南](docs/getting-started.md)中的“在预览里走一遍产品”进行。实际安装请使用上方对话入口；source-candidate 安装测试仍是 developer/test-only，不能替代真实用户验收。

## 当前做到哪里

| 项目 | 当前事实 |
|---|---|
| Source / package version | `0.2.6` |
| 公共发行源码 | `v0.2.6` 绑定 `b1813b463bf58635d71da5f9df6bd37aae036081`；后续文档提交不改变发行身份 |
| 双仓对应 | 私有源码 `2a801c895918e19c5bf63530fb72419ca9ed7f4a` → 独立公共源码；未公开私有历史 |
| Public Release / distribution | GitHub 不可变 `v0.2.6` 与 npm `0.1.0` 已发布；npm `0.1.1` 下载修正待验证发布 |
| 真实安装 / Skill / 项目接入验收 | 新公共路径均 `pending`，不以隔离工程验证代替本人确认 |
| macOS 历史使用 | 0.2.2 安装/重开已有用户记录；不是本次公共入口的验收 |
| Windows 真实机器与分发 | `pending` |
| 项目数据 | 项目内保存；默认 `unmanaged`；普通停用/卸载保留 |

已接受的 028R3 历史证据包括：私有 `source-equivalent-contained` 351/351、两个 export tree 各 322/322，以及 macOS 浏览器 2 pass / 2 Windows-only skip。它们证明的是当时冻结源码和导出树，不是本次文档提交的新运行，也不替代真实用户、Windows、签名或分发验收。完整状态见[当前状态](docs/current-status.md)和[验证基线](docs/verification-baseline.md)。

## 安全和控制边界

```text
用户表达意图
→ AI 读取事实或准备计划
→ Foundation 展示准确范围
→ 用户在 Foundation 中确认
→ 确定性程序执行
→ 验证结果
```

AI 不能自行授权安装、更新、卸载、项目启用/停用或 capability 激活。对话中的“确认”、计划 ID、命令参数和浏览器请求都不能替代 Foundation 中针对本次操作的明确人类确认。AI 可调用面仍只有 `Foundation:inspect`、`Foundation:request-plan`、`Foundation:open-manager`、`Foundation:status`；它们不是 mutation authority。

## 文档地图

- [Codex 安装说明](docs/install-with-codex.md)：公共 Release 获取、目录选择、本人确认、重开和独立 Skill 接入。
- [入门指南](docs/getting-started.md)：在开发预览中走一遍产品，以及 source-candidate 和项目数据边界。
- [当前状态](docs/current-status.md)：版本、平台证据和未关闭门。
- [验证基线](docs/verification-baseline.md)：公开安全的历史测试与导出证据。
- [数据契约](docs/data-contract.md)：`.foundation/facts` 的记录范围和约束。
- [架构与安全边界](docs/architecture.md)：本地工作台、确定性执行与授权分层。
- [CLI 参考](docs/cli-reference.md)：开发者命令、读写范围和恢复路径。
- [安装平台边界](docs/install-platform-024.md)：source candidate 与真实安装的区别。
- [第三方声明](THIRD_PARTY_NOTICES.md)：依赖和生成产物的许可证义务。

## 开发检查

```sh
npm run build
npm test
npm run test:browser
npm run audit:deps
npm run audit:ui
```

Windows-only 项目在非 Windows 主机上会标记为不适用；skip 不能当作 Windows 通过。完整 CLI 不在 README 重复，见[CLI 参考](docs/cli-reference.md)。

## 许可证与公开仓库

公开仓库的自有代码采用 MIT，见根目录 `LICENSE`；第三方许可和声明保留。私有开发仓库仍为 private。软件许可证、公开范围、公开仓库名称、exact repository identity 和 exact private source commit 是独立核验门；一次明确发布授权覆盖经过这些检查的双仓流程，不允许跳过失败或扩大公开范围。公开快照的 PRIVATE→PUBLIC 提交对应关系可在生成的 provenance 中复核，两库 SHA 不要求相同。

开发树生成的 unsigned source candidate 不是可供普通用户安装的正式 Release；正式入口必须来自对应公共仓库的不可变发行并通过 GitHub 来源证明和完整性校验。本地区分不以独立 Foundation 签名密钥为前置，不冒充 Apple 签名/公证或真人验收。
