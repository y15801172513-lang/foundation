# 当前状态与发布就绪度

## 035 当前发行（2026-09-11）

公共不可变 [v0.2.7](https://github.com/y15801172513-lang/foundation/releases/tag/v0.2.7) 与 [npm 0.1.2](https://www.npmjs.com/package/@josephyulei/summon-foundation/v/0.1.2) 已发布，发行证明、资产长度/摘要及 npm registry 实际 tarball 已回读。运行载荷绑定公共提交 `1f99eecd4b21bf29b004e1110ef515466f7f3ed8`；安装说明跟随当前 main，不替代该不可变身份。

默认短命令现在实际获取并等待安装页目录选择，不再只返回发行发现。精确确认、隔离安装/重开、更新清理和卸载保护回归通过；新对话接续、本人安装、Skill 发现及主动完成告知仍 pending。新版发布不等于用户安装已更新。旧版记录如下，不能代替本轮实时状态。

本页记录当前源码 checkpoint、短期事实和未关闭门，不把私有 Result 复制成第二套叙事。公开安全的历史证据见[验证基线](verification-baseline.md)。

| 维度 | 当前事实 | 含义 |
|---|---|---|
| Source / package version | `0.2.6` | 版本 authority 是 foundation-kit.json；对应公开/私有 SHA 由每次发行映射记录 |
| 开发与公开 | 私有开发、独立公共快照 | 公开库只包含审核后的源码、文档、许可证及发行内容，不含私有 Git 历史 |
| 许可证 | 自有代码 MIT 已批准 | 第三方许可证及完整声明保留，不能以 MIT 覆盖第三方条件 |
| 发行可用性 | [公共不可变 v0.2.6](https://github.com/y15801172513-lang/foundation/releases/tag/v0.2.6) 已发布，三资产 GitHub 来源证明通过 | 公共源码 `b1813b463bf58635d71da5f9df6bd37aae036081` 对应私有源码 `2a801c895918e19c5bf63530fb72419ca9ed7f4a`；入口见 [安装说明](install-with-codex.md) |
| npm | [0.1.1 已发布](https://www.npmjs.com/package/@josephyulei/summon-foundation/v/0.1.1)，匿名 tarball 与审核字节一致 | npm 源码：私有 `76c22a3353c8303c92eea3794a74a7707e36418d` → 公共 `9cb7808f609b82dfd4ab119cb49daae87cfeadba`；无静默安装脚本 |
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

- npm `0.1.0` 的慢速大归档传输失败已保留证据；`0.1.1` 最小修正已完整通过真实匿名来源/摘要/解包与隔离确认页验证，未发送安装确认。
- 本次公共发行的本人安装、Skill 注册/新对话发现、真实项目使用仍分别待验收；匿名工程验证不是本人安装通过。
- 真实更新、宿主成功后暂存清理、恢复和卸载仍需当次用户确认；隔离工程通过不代替真人验收。
- Apple Developer ID/公证未提供；Windows、自动更新和独立发行密钥后置，不绕过系统安全检查。

许可证、公共名称/身份与公开范围已由用户确认。公共仓库为独立历史；私有开发库保持 private。正式导出已从精确提交重复构建并验证，两库 SHA、版本与资产摘要分别绑定；文档同步不重写不可变发行。

## 下一步接受门

由用户在具备安装权限的新 Codex 对话中发起安装，在页面亲自确认。安装、Skill 和项目接入分别确认、分别验收；不增加新的安装器或通知桥接。慢速连接的大文件获取有 20 分钟上限，仍可能因环境断线安全失败，不自动重放安装。

## 从产品首页移入的详细记录（035）

## 当前做到哪里

| 项目 | 当前事实 |
|---|---|
| Source / package version | `0.2.6` |
| 公共发行源码 | `v0.2.6` 绑定 `b1813b463bf58635d71da5f9df6bd37aae036081`；后续文档提交不改变发行身份 |
| 双仓对应 | 私有源码 `2a801c895918e19c5bf63530fb72419ca9ed7f4a` → 独立公共源码；未公开私有历史 |
| Public Release / distribution | GitHub 不可变 `v0.2.6` 与 npm `0.1.1` 已发布并回读；旧资产不覆盖 |
| npm 源码对应 | 私有 `76c22a3353c8303c92eea3794a74a7707e36418d` → 公共 `9cb7808f609b82dfd4ab119cb49daae87cfeadba`；与运行载荷独立递增 |
| 真实安装 / Skill / 项目接入验收 | 新公共路径均 `pending`，不以隔离工程验证代替本人确认 |
| macOS 历史使用 | 0.2.2 安装/重开已有用户记录；不是本次公共入口的验收 |
| Windows 真实机器与分发 | `pending` |
| 项目数据 | 项目内保存；默认 `unmanaged`；普通停用/卸载保留 |

已接受的 028R3 历史证据包括：私有 `source-equivalent-contained` 351/351、两个 export tree 各 322/322，以及 macOS 浏览器 2 pass / 2 Windows-only skip。它们证明的是当时冻结源码和导出树，不是本次文档提交的新运行，也不替代真实用户、Windows、签名或分发验收。完整状态见[当前状态](current-status.md)和[验证基线](verification-baseline.md)。
