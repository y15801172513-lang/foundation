# 入门指南

Foundation 有三个不同层次：源码开发预览、source-candidate 安装测试、已安装产品。当前可以直接尝试的是本地源码预览；真实用户路径上的正式安装仍待验收。

普通用户从 [Codex 安装说明](install-with-codex.md) 开始，先核验实际已发布的固定版本，再通过对话说明与本人页面确认安装。下方开发构建步骤不是用户安装步骤。本文不单独证明发行或真人验收通过。

正式运行文件来自公共版本化 GitHub Release，Codex 自动获取；Actions 临时文件不是安装源。npm 薄入口需要 Node/npm，匿名验证不要求 GitHub 登录；已安装产品使用随包运行时，重开不依赖全局 Node/npm。缺少工具先按安装说明处理，不自动安装全局依赖。实际安装、Skill 接入和新对话调用独立验收。

本轮以两位主要用户的 macOS 使用为准，不另建独立发行密钥体系；使用固定 Release、GitHub 来源证明及字节校验。旧文档中“缺独立发行签名”的描述不再是当前最小流程的前置条件；真实 GitHub 获取和系统执行仍须实测。

## 在预览里走一遍产品

要求 Node.js `>=20.19.0`。从仓库根运行：

```sh
npm ci
npm run preview
```

固定入口会在需要时构建管理中心和 `foundation-events`，然后在 `http://127.0.0.1:4317/` 提供本地工作台。它只管理仓库内示例，不会安装 Foundation，也不会启用真实产品项目。

建议先走这条路径：

1. 在页面预览中找到一个 EventCard，打开“检查对象”。
2. 在“页面与完整层级”中确认它属于哪个页面、位于哪条对象路径，是组件还是普通页面结构。
3. 查看“默认修改范围”和“使用、影响与已知缺口”。已登记组件会提示复核其他已知使用位置；普通结构会优先建议限制在当前位置。
4. 从“复制”菜单选择“身份与层级”“相关逻辑”“布局与样式”“使用、影响与缺口”或“完整对象上下文”。
5. 在复制内容后补上明确的修改目标，再交给 AI 或开发者。复制上下文帮助把任务说具体，不保证自动修改正确。
6. 切换到“页面逻辑”或“信息与逻辑”，检查已登记的页面进入、去向、触发条件和验证状态。

“相关逻辑”只筛选当前页面的已登记关系，并以触发词和对象名称做匹配；它不是全部业务逻辑或因果依赖的自动发现。关系的登记状态与运行时绑定状态分开显示；保存一条关系事实不会实现产品运行跳转。

查看预览状态或停止：

```sh
npm run preview:status
npm run preview:stop
```

## 工作台读取什么

项目启用后，`.foundation/facts/*.json` 保存页面、组件、关系、交互、资产和变更等长期事实。预览可以为已接入页面返回对象身份、层级及有限布局/样式摘要。工作台只展示已登记或已返回的内容；缺失、待确认、冲突和未验证状态不会被补写成已知事实。

组件与资产的“已知使用位置”来自登记数据和投影，不证明所有传递依赖。真正修改前仍需核对当前代码、运行结果与未登记影响。

## Source-candidate 安装测试

`npm run candidate` 会在仓库 `.tmp/` 下构建当前平台的 unsigned candidate。它复制当前本机 Node 作为未验证的私有 Runtime 候选，因此不是公开分发包。该命令及任何带 `--root`、`--sandbox-root` 的生命周期示例都是 developer/test-only，不应当作普通用户安装说明。

维护者可显式选择已下载的固定官方 Runtime 归档供构建器验证；此路径包含许可证和来源摘要，不等于 Foundation 已签名/公证。构建器拒绝复用已有工作/输出目录，以保留旧产物和失败证据。自选目录与 Codex 浏览器模式已进入首装接口，但尚未通过完整真实用户门。

candidate 顶层入口概念上是：

```sh
"<candidate-directory>/foundation-kit" install
```

它会验证 candidate，并打开只监听 loopback 的 Foundation 确认界面。当前不应把它指向真实用户安装路径；真实 macOS 用户路径 install/update/rollback/repair/uninstall 尚未完成独立验收。

## 已安装产品使用

`pending`：当前没有正式 Release、可信 acquisition channel、签名或 notarization，也没有已验收的普通用户安装步骤。只有这些门关闭后，本文才会提供下载、校验、安装和更新说明。

## 项目启用、停用与数据保留

安装软件和授权项目是两件事。新项目与已有项目默认都是 `unmanaged`。

只读盘点明确项目：

```sh
./foundation-kit project inventory --project /absolute/path/to/product
```

准备启用或停用计划：

```sh
./foundation-kit project enable plan --project /absolute/path/to/product --root <installation-root>
./foundation-kit project disable plan --project /absolute/path/to/product --root <installation-root>
```

这些命令只生成或展示计划，不执行 effect。实际 effect 必须由可信宿主保存计划、取得 opaque `planRef`、打开 Foundation 本地管理器，并由用户在界面确认。普通 CLI 的 `apply` 入口已关闭。

启用后，项目内 portable binding 与安装内签名登记必须一致。复制或移动项目不会自动继承管理权。停用立即停止 Foundation 管理，但保留项目源码和 facts。

项目自身可包含：

- `.foundation/foundation.json`：项目身份与数据格式；
- `.foundation/facts/*.json`：长期事实权威；
- `.foundation/preview.json`：本地预览白名单映射，不是事实权威。

普通 Foundation 软件卸载可以 detach 可确认的机器登记，但保留项目源码、身份与 `.foundation/facts`。永久删除 facts 是独立破坏性操作，需要另行计划和确认。

错误恢复先运行只读 `status`、`doctor` 或相应 `recover plan`；不要手改签名状态、复制计划 ID、重放旧确认或删除 lock/journal 绕过流程。完整命令见 [CLI 参考](cli-reference.md)。

## 从产品首页移入的详细记录（035）

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

第一次浏览开发预览建议按[入门指南](getting-started.md)中的“在预览里走一遍产品”进行。实际安装请使用上方对话入口；source-candidate 安装测试仍是 developer/test-only，不能替代真实用户验收。

## 开发检查

```sh
npm run build
npm test
npm run test:browser
npm run audit:deps
npm run audit:ui
```

Windows-only 项目在非 Windows 主机上会标记为不适用；skip 不能当作 Windows 通过。完整 CLI 不在 README 重复，见[CLI 参考](cli-reference.md)。
