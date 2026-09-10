# summon foundation

Foundation 的薄获取入口，不包含完整运行包，没有 npm 安装生命周期脚本。
只有明确执行才查询/获取；安装和 Skill 注册继续各自需要用户确认。

可用性以 npm registry 的实际版本和公共 GitHub Release 为准；本目录或说明存在不是发布回执。只使用本项目已核验的包名，缺包时不换同名来源。

```text
npx --yes --package @josephyulei/summon-foundation@0.1.0 summon foundation
```

由 Codex 读取返回的固定安装说明后继续对话，先解释版本、目录、写入影响和权限；`--prepare --version <固定版本> --destination <绝对目录>` 获取后进入本人确认。`--acquire --version <固定版本>` 只准备更新输入，不执行更新；更新使用已安装稳定入口。没有 npm 时可先从 GitHub 安装说明开始检查环境，不自动安装全局依赖。

需要 macOS arm64、Node.js 22.9+ 与 npm。首次命令在 Codex 任务中查询版本并提供固定来源的接续信息；普通终端不能操控或唤醒 Codex。
固定版本准备阶段匿名校验 GitHub 仓库身份、不可变 Release、签名证明、时间戳、源码提交和资产字节，随后使用随包运行时进入现有 Foundation 确认页面。
不关闭 Gatekeeper、不清除隔离属性，不冒充 Apple 签名或公证。遇到权限问题安全停止。

尚无 Foundation / Skill 的缓存说明：[公开清理指南](https://github.com/y15801172513-lang/foundation/blob/main/docs/cache-cleanup.md)。该链接须在正式发布后回读核验；当前 README 不是发布完成回执。
