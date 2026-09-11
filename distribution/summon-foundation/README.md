# summon foundation

Foundation 的薄获取入口，不包含完整运行包，没有 npm 安装生命周期脚本。
只有明确执行才查询/获取；安装和 Skill 注册继续各自需要用户确认。

可用性以 npm registry 的实际版本和公共 GitHub Release 为准；本目录或说明存在不是发布回执。只使用本项目已核验的包名，缺包时不换同名来源。

```text
npx --yes --package @josephyulei/summon-foundation@0.1.2 summon foundation
```

0.1.2 入口配合 Foundation 0.2.7 或后续支持目录选择的正式发行使用。默认命令实际查询、固定版本、披露缓存、下载并校验，然后保持运行等待安装页目录选择。选择目录后还要亲自确认精确安装计划；不会注册 Skill 或接入项目。实际获取仍须通过 registry 与 Release 校验，本文不替代发布证明。

Codex 需要打开返回的内置浏览器网址，并分段等待同次操作结果。npm 不能自行操控或唤醒 Codex，对话主动告知不是程序退出码保证；新对话接续仍待真人验收。系统浏览器只是明确告知后的备用，不自动打开。

显式 `--inspect` 才只查询，不下载运行文件。已有选择时可用 `--prepare --version <固定版本> --destination <绝对目录>`；`--acquire --version <固定版本>` 只准备更新输入，不执行更新。更新使用已安装稳定入口。旧运行版不支持页面选择时拒绝自动采用默认目录。没有 npm 时先从 GitHub 安装说明检查环境，不自动安装全局依赖。

需要 macOS arm64、Node.js 22.9+ 与 npm。无 TTY 不会卡在终端提问；目录选择在页面进行，关闭页面不算确认或取消。
固定版本准备阶段匿名校验 GitHub 仓库身份、不可变 Release、签名证明、时间戳、源码提交和资产字节，随后使用随包运行时进入现有 Foundation 确认页面。
不关闭 Gatekeeper、不清除隔离属性，不冒充 Apple 签名或公证。遇到权限问题安全停止。

尚无 Foundation / Skill 的缓存说明：[公开清理指南](https://github.com/y15801172513-lang/foundation/blob/main/docs/cache-cleanup.md)。当前 README 不是安装完成回执。
