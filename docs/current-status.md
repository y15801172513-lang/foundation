# 当前状态与发布就绪度

本页记录当前源码 checkpoint、短期事实和未关闭门，不把私有 Result 复制成第二套叙事。公开安全的历史证据见[验证基线](verification-baseline.md)。

| 维度 | 当前事实 | 含义 |
|---|---|---|
| Source / package version | `0.2.6` | 版本 authority 是 foundation-kit.json；对应公开/私有 SHA 由每次发行映射记录 |
| 开发与公开 | 私有开发、独立公共快照 | 公开库只包含审核后的源码、文档、许可证及发行内容，不含私有 Git 历史 |
| 许可证 | 自有代码 MIT 已批准 | 第三方许可证及完整声明保留，不能以 MIT 覆盖第三方条件 |
| 发行可用性 | 以实际不可变 Release 和 npm registry 为准 | 源码、空仓库或工程报告不是已发布证明；入口见 [安装说明](install-with-codex.md) |
| npm | 独立薄启动包 | 根工程仍 private 防误发；薄包仅在明确执行时获取，不含静默安装脚本 |
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

## 当前阻塞

- `LICENSE_DECISION_REQUIRED`
- `PUBLIC_REPOSITORY_NAME_REQUIRED`
- `PUBLIC_EXPORT_SCOPE_REVIEW_REQUIRED`
- `PUBLIC_REPOSITORY_CREATION_PENDING`
- `PUBLIC_REPOSITORY_IDENTITY_REQUIRED`
- `REAL_MACOS_LIFECYCLE_ACCEPTANCE_PENDING`
- Windows真实机器、可信Runtime provenance、签名/notarization与acquisition channel仍待完成。

## 下一步接受门

029完成后先由Work独立复核产品故事、事实映射、C1/C2私有保存与C2 fresh A/B receipts。公开仓库仍需用户分别决定名称、LICENSE/政策、exact remote identity、公开范围与exact approved private source commit；创建和首次同步另行授权。

正式导出必须是 `clean-exact-commit-approved`，合同和每条记录从exact Git commit objects派生，并在两个fresh run中build、verify与pair verify。Review export始终publicationEligible=false；receipt不是签名或批准。首次同步仍要展示add/modify/delete/preserve计划并再次确认，且保留public-owned LICENSE、SECURITY、贡献/支持文件及.github内容。它不是软件Release。

GitHub可见性、软件许可证、npm private标志与Release readiness是四个独立决定，不能相互替代。
