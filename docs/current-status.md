# 当前状态与发布就绪度

本页记录当前源码 checkpoint、短期事实和未关闭门，不把私有 Result 复制成第二套叙事。公开安全的历史证据见[验证基线](verification-baseline.md)。

| 维度 | 当前事实 | 含义 |
|---|---|---|
| Source / package version | `0.2.6` | 版本 authority 是 foundation-kit.json；对应公开/私有 SHA 由每次发行映射记录 |
| 开发与公开 | 私有开发、独立公共快照 | 公开库只包含审核后的源码、文档、许可证及发行内容，不含私有 Git 历史 |
| 许可证 | 自有代码 MIT 已批准 | 第三方许可证及完整声明保留，不能以 MIT 覆盖第三方条件 |
| 发行可用性 | [公共不可变 v0.2.6](https://github.com/y15801172513-lang/foundation/releases/tag/v0.2.6) 已发布，三资产 GitHub 来源证明通过 | 公共源码 `b1813b463bf58635d71da5f9df6bd37aae036081` 对应私有源码 `2a801c895918e19c5bf63530fb72419ca9ed7f4a`；入口见 [安装说明](install-with-codex.md) |
| npm | `@josephyulei/summon-foundation@0.1.0` 已发布并回读；`0.1.1` 下载修正准备中 | 独立薄包；根工程仍 private 防误发，不含静默安装脚本 |
| 平台 | macOS arm64 | npm 获取需 Node/npm；已安装运行使用随包 Runtime，无 Apple Developer ID/公证声明 |
| 真实安装与 Skill | 分别待用户实际确认 | 工程隔离测试、文件存在、注册记录均不等于新对话实际发现和调用 |
| 更新暂存 | 同次精确计划与宿主后处理 | 成功、健康、事务结束和消费者退出后清理；失败/未知/修改/共享项保留 |
| 项目与数据 | 默认不接入 | 接入独立确认；普通卸载保留 facts、身份、项目源码和备份 |
| Windows / 自动更新 | 后置 | 不扩建多平台、自动更新服务或独立发行密钥体系 |

## 已接受的历史证据

028R3在提交C1前的同一冻结实现上，由Work独立复核并接受：

- 私有 `source-equivalent-contained`：351/351 pass，0 fail，0 skip。
- 两份实际review export tree：A 322/322、B 322/322，均0 fail/skip；测试后字节与receipt复验不变。
- 原始 `npm run test:browser`（macOS）：2 pass、0 fail、2项Windows-only skip。
- 1,475次实际健康探针：零timeout、零异常signal；每面一次exit23为被断言的负向fixture。
- management-center与foundation-events build，以及documentation/publication/dependency/offline/UI/production/mutation/candidate audits完成。

这些是C1之前冻结代码的历史接受证据，不是029文档修订的新全量运行。029以独立path/type/mode/hash不变量证明runtime、lifecycle、authority、packaging、schema、dependency、version与test-host production边界相对C1未变，再运行文档/发布、focused及parser相关检查，并建立当前C2的fresh A/B review export证据。

## 当前未关闭门

- npm `0.1.0` 的正式只读短命令与匿名包字节已通过；慢速链路的大归档传输失败，`0.1.1` 最小修正正在完整复验，不能把发现成功算获取到页面通过。
- 本次公共发行的匿名获取到页面、本人安装、Skill 注册/新对话发现、真实项目使用分别记账。
- 真实更新、宿主成功后暂存清理、恢复和卸载仍需当次用户确认；隔离工程通过不代替真人验收。
- Apple Developer ID/公证未提供；Windows、自动更新和独立发行密钥后置，不绕过系统安全检查。

许可证、公共名称/身份与公开范围已由用户确认。公共仓库为独立历史；私有开发库保持 private。正式导出已从精确提交重复构建并验证，两库 SHA、版本与资产摘要分别绑定；文档同步不重写不可变发行。

## 下一步接受门

完成 npm 修正版验证、发布与匿名回读后，由用户在具备安装权限的新 Codex 对话中发起安装，在页面亲自确认。安装、Skill 和项目接入分别确认、分别验收；不增加新的安装器或通知桥接。
