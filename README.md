# Foundation

和 AI 一起改界面，先把「改哪里」说清楚。

Foundation 是一个本地工作台。你可以在页面预览里选中一个按钮、一张卡片或一块布局，查看它属于哪个组件、和哪些页面有关，再把这些信息交给 AI，少一些「左边那个」「不是这里」的来回解释。

它把项目里已经记录的页面、组件、交互和图片等资料放在一起。没有记录的信息会显示为缺失或待确认，不会假装已经看懂整个项目。

[![Foundation 工作台：左侧预览页面，右侧查看页面之间的跳转关系](docs/foundation-workbench-example.png)](docs/foundation-workbench-example.png)

*仓库自带的事件管理示例。点击图片查看高清原图。*

## 它能帮你做什么

| 你想做的事 | 在 Foundation 里怎么做 |
|---|---|
| 找到要改的按钮、卡片或布局 | 在预览中选中它，查看它在页面里的位置和所属组件。 |
| 弄清一个页面从哪里来、能去哪里 | 查看已记录的页面跳转、触发条件和状态变化。 |
| 把修改要求说清楚 | 复制选中部分的位置、结构和相关信息，再补上你的要求。 |
| 修改共用组件前，看看会影响哪里 | 查看已记录的使用页面和实例，区分「只改这里」和「修改共用组件」。 |
| 换个对话继续做项目 | 页面、组件和修改记录留在项目文件里，下次可以接着查看和补充。 |

这些信息需要随项目维护。已记录的使用位置可能不全，也不代表完整依赖分析；Foundation 不保证 AI 一定改对，实际修改仍须核对代码和结果。

## 用 Codex 安装

目前支持 **macOS Apple Silicon（M 系列芯片）**。首次安装需要 **Node.js 22.9+、npm 和网络**；Codex 需要能执行本地命令、打开浏览器，并有安装目录的写入权限。

新建一个有安装权限的 Codex 对话，不要选 Foundation 源码目录，然后粘贴：

```text
npx --yes --package @josephyulei/summon-foundation@0.1.13 summon foundation --version 0.2.31
```

安装页会让你选择文件夹，以及是否启用 Foundation 的 Codex 对话功能（Skill）。下载和校验完成后，你可以查看具体安装内容，再点击确认。程序和对话功能分别确认，整个过程都在同一个页面里完成。

不需要克隆仓库或手动解压。缺少 Node.js、npm 或权限时，Codex 会先说明需要准备什么，不会自动安装全局工具。完整步骤见[安装说明](docs/install-with-codex.md)。

当前版本：[Foundation 0.2.31](https://github.com/y15801172513-lang/foundation/releases/tag/v0.2.31) · [npm 0.1.13](https://www.npmjs.com/package/@josephyulei/summon-foundation/v/0.1.13)。

## 开始使用

安装后，让当前对话「打开 Foundation」。如果想在以后的 Codex 对话中这样使用，需要在安装时或之后确认启用 Skill；启用后，请在新对话里试一次。完整命令见[对话指令说明](docs/conversation-commands.md)。

接着选择你要使用的项目。Foundation 会说明需要准备哪些资料、会改动哪些文件，等你确认后才接入；不自动扫描或启用其他项目。已有的技术栈、项目规则和资料会保留，预览接入也由你选择。没有接入项目时，工作台就是空的。

例如，你想调整一张卡片的间距：

1. 在预览中选中要改的部分，复制它的位置、结构和关联信息。
2. 把复制的内容发给 AI，再加上「把这张卡片的上下间距加大，只改当前页面，不改共用组件」。
3. 修改后回到预览检查效果，并让 AI 把项目记录更新到最新状态。

之后继续使用同一个项目。如果页面或记录还没同步，先完成同步，再检查结果。项目准备、制作规则和预览接入的具体步骤见[项目使用说明](docs/rules-and-project-use.md)。

## 更新、卸载与数据

- **更新**：告诉 Codex「更新 Foundation」。它会先检查当前安装、获取目标版本，再等你确认；不会因为有新版就自动更新。
- **失败后继续**：先查看上一次的结果，确认哪些步骤已经完成，再处理剩下的部分，避免从头重复执行。
- **卸载**：告诉 Codex「卸载 Foundation」。卸载只处理属于这份安装的文件，保留项目源码、项目资料，以及你添加或修改过的文件。
- **项目资料**：页面、组件、关系等信息保存在项目自己的 `.foundation/facts/` 中，不会因普通卸载而删除。
- **下载缓存**：安装或卸载后可能仍会保留，如何查看和清理见[缓存说明](docs/cache-cleanup.md)。

安装后的 Foundation 自带运行环境，重新打开时不再依赖系统里的 Node.js 或 npm。安装页关闭后仍可查看操作结果，但网页不能唤醒一个已经结束的 Codex 对话。

## 目前有哪些限制

目前是试用版。安装、更新和卸载已在隔离环境中验证；真实用户环境，以及新 Codex 对话能否正确识别并使用 Skill，仍待真人验收。

Foundation 展示的是已接入项目中已有的记录，不能自动理解所有代码，也不能直接检查任意网站。暂不支持 Windows 或自动更新，旧版支持情况见[支持策略](docs/install-platform-024.md#现行支持策略)。

运行文件从 GitHub Release 下载，并校验来源和文件内容。目前还没有 Apple Developer ID 签名或公证；如果 macOS 阻止运行，请保留提示并检查原因，不要关闭 Gatekeeper 或移除隔离属性来绕过检查。

## 进一步了解

- [入门指南](docs/getting-started.md)：体验示例，或从源码启动开发预览。
- [安装说明](docs/install-with-codex.md)：安装、重新打开、启用 Skill 和恢复中断操作。
- [当前状态](docs/current-status.md) · [验证记录](docs/verification-baseline.md)：已经验证的内容和仍待确认的事项。
- [数据格式](docs/data-contract.md) · [架构与安全](docs/architecture.md) · [CLI 参考](docs/cli-reference.md)：面向开发者的详细说明。

公开代码采用 [MIT 许可证](https://github.com/y15801172513-lang/foundation/blob/main/LICENSE)，第三方许可证见[第三方声明](THIRD_PARTY_NOTICES.md)。仓库只包含审核后的公开内容，私有开发历史不公开。
