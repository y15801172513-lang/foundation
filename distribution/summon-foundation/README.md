# summon foundation

当前用户共用一份程序与一份可选对话功能。安装仅选择软件位置，不选择业务项目。各项目随后单独接入，资料各自保管；旧安装不自动迁移或覆盖。

保留真实下载状态与独立确认。基础环境不能安全启动页面时，由 Codex 对话先披露并取得独立批准，再准备专用环境；页面启动后全程同页。具体方法见仓库 `docs/install-with-codex.md`，不能先运行 npx 来准备缺失的 Node。不修改共享 PATH；获取器专用环境及其回执按缓存保留，程序另用随包运行时。发行发现仅需 curl，获取还需 tar；已验证载荷的确认、恢复和卸载不依赖下载工具。

0.1.8 单页试用入口与 Foundation 0.2.14 的运行引擎共同支持当前用户共用安装及清晰的完成、取消和部分完成反馈。同一页面内保留目录选择、程序和 Skill 独立确认。真实安装、新任务发现和主动告知仍需独立验收。

首次 URL 持续显示本次流程；确认仅转交本次受控子进程的当前计划，不新开manager页。--acquire仍只读获取；--resume仅在用户明确要求后恢复未完成Skill，不重放程序安装。

Foundation 的薄获取入口，不包含完整运行包，没有 npm 安装生命周期脚本。
只有明确执行才查询/获取；安装和 Skill 注册继续各自需要用户确认。

可用性以 npm registry 的实际版本和公共 GitHub Release 为准；本目录或说明存在不是发布回执。只使用本项目已核验的包名，缺包时不换同名来源。

确认 registry 中存在本版本及对应不可变 Release 后，在具备安装权限的新 Codex 对话粘贴：

```text
npx --yes --package @josephyulei/summon-foundation@0.1.8 summon foundation
```

旧版退出推荐入口；支持边界见[现行支持策略](https://github.com/y15801172513-lang/foundation/blob/main/docs/install-platform-024.md#现行支持策略)。旧不可变版本不修改，不自动迁移或清除旧安装。

Codex 需要打开返回的内置浏览器网址，并分段等待同次操作结果。npm 不能自行操控或唤醒 Codex，对话主动告知不是程序退出码保证；新对话接续仍待真人验收。系统浏览器只是明确告知后的备用，不自动打开。

联网前建立操作记录，网络失败保留脱敏类别和退出码；--status只读恢复同次结果，不重试或重放。程序健康核验后结果留在本页，工作台由用户另行打开。工具yield不是任务完成，Codex须继续分段观察；HTML不能唤醒已结束任务。

显式 --inspect 只查询发行。默认命令先在页面选择目录与Skill意向，再下载核验；最终精确计划仍需本人确认。--prepare传入的目录只是意向；--acquire只准备更新输入。更新/卸载仅使用支持单页的已安装稳定入口，不回退旧页面。

需要 macOS arm64、Node.js 22.9+ 与 npm。无 TTY 不会卡在终端提问；目录选择在页面进行，关闭页面不算确认或取消。
固定版本准备阶段匿名校验 GitHub 仓库身份、不可变 Release、签名证明、时间戳、源码提交和资产字节，随后使用随包运行时进入现有 Foundation 确认页面。
不关闭 Gatekeeper、不清除隔离属性，不冒充 Apple 签名或公证。遇到权限问题安全停止。

尚无 Foundation / Skill 的缓存说明：[公开清理指南](https://github.com/y15801172513-lang/foundation/blob/main/docs/cache-cleanup.md)。当前 README 不是安装完成回执。
