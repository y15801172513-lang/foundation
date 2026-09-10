# Install / create / upgrade

> 026 边界：Foundation 不防御已拥有同一用户 shell 与不受限文件系统权限的恶意 AI 或进程。AI 只能检查、请求计划、打开本地管理器和读取状态；AI、CLI 参数、plan hash 或对话中的“确认”都不能执行 mutation。

本地管理器的轻量确认不以加密方式证明人在场，也不防御同一用户的浏览器自动化；内部 loopback HTTP 不是针对同一用户攻击者的安全边界。

所有安装、更新、修复、回退、卸载、项目 enable/disable、布局迁移与永久数据删除遵循同一管线：只读 inspect → exact plan → Foundation 本地管理器展示目标/创建/替换/删除/保留 → 用户点击操作专属确认 → 完整状态复核 → 确定性引擎执行与验证。软件安装和更新不会扫描或启用产品项目，也不会迁移项目 facts。

`setup` 只检查 Node 与本地目录。`create` 不再一步写入：它使用和 existing-project enable 相同的 project-authority plan → explain → 可信宿主记录本次直接人类决定 → apply 流程，apply 才复制 packaged template 并建立 portable binding 与 signed machine registration。模板只是 blueprint，永远不是 enabled 项目；创建失败会恢复原本不存在或为空的目标。

已有项目默认 `unmanaged`，即使已有 `.foundation`、曾被 inventory 或可被 Skill 看到也不构成同意。`inventory` 只对明确绝对路径做临时 `inventory-only` 读取，不创建 `.foundation`、registry、lock、log 或 cache。enable 后 portable record 不包含绝对路径；installation 的 `state/projects.json` 保存签名的 real path、目录 identity、binding version 与确认凭据。两者必须一致，复制/移动不会自动继承管理权。

`disable` 将两侧记录改为 disabled，立即阻止 facts、management-center、extension、generated output 与 migration 写入；项目源码、组件、资产及 `.foundation/facts` 全部保留，Foundation 软件也不被卸载。`upgrade` 只允许 enabled 项目，并为这一笔升级生成独立 mutation plan；失败自动恢复备份。原 `install-skill` 直写入口已关闭：Skill 只是 installed app 内的惰性 capability artifact，必须依次通过独立的 capability install、register、activate plan 与人类授权，且 activation 也不授权未来写入。

create/skeleton、facts relation、shadcn apply/remove 与 facts upgrade 不接受 callback、command、module path 或调用方 registry。plan 会绑定固定内部 handler、canonical payload、before-state 与 exact allowed write set；project transaction 在父级 signed pre-intent 和独占 project guard 后才 consume receipt。进程若在 consume 前退出，项目 bytes 不变且 reservation 只能被 exact recovery 取消；consume 后退出时只能按已签名 before-bytes 回滚或进入 manual action，不能重放原 receipt 或推断新同意。

candidate 不携带 `project-mutation-handlers.mjs`、`trusted-authority.mjs` 或 `trusted-intent-ledger.mjs` 的可 deep-import 物理副本。上述 raw implementation 只作为 authorized dispatcher 模块内的词法私有函数存在；测试若需要 signer/raw adversarial fixture，只能使用未打包的 `tests/` loader/module。
