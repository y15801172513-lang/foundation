# 制作规范与项目采用

037 的本地实现待发布及独立验收；现有稳定版不因此获得新接口。使用时先核验实际 installed current 的帮助与支持列表，不猜测版本。

产品的制作规范唯一正文在 `rules/foundation-making.md`，随候选进入 `artifacts/rules`，由现有 descriptor 与安装回执共同校验。程序版本、ruleVersion、adoptionSchemaVersion 和项目数据格式不是同一个版本。私有制作 Foundation 的工程规范不随用户载荷分发。

已安装入口支持时，用 `rules inspect --root <精确安装根>` 只读获取当前完整规则。项目已启用后附加 `--project <精确项目>`，返回 `projectRulesReady` 和项目例外；文件缺失、篡改、停用、身份漂移或不兼容时不回退旧副本。此命令不自动安装、修复、采用或注册 Skill。

## 从接入到制作

1. 用户选择实际项目，按已有独立 enable 计划确认。现有代码和框架不变；enable 只建立身份与绑定，不表示必要事实齐全。随后从稳定入口 rules inspect --root <安装根> --project <项目> 检查 preparation/nextStep。缺必要文件时通过现有 manager project-mutation 的 foundation-skeleton-and-facts-create 单独确认精确补齐清单，handlerPayload 使用 includePreview:false 与本次 generatedAt；不覆盖已有事实、源码或规则。完成后重新 inspect；取消、失败或冲突不得继续宣称就绪。
2. 当前 manager 的 supportedProjectOperations 声明 `project-rules-adopt` 时，再请求同一 `project-mutation` 入口；handlerPayload 包含同一 installationRoot、明确 technology（`react-shadcn` 或 `preserve`）与 generatedAt。它展示追加的 AGENTS 指引及 `.foundation/identity/rules-adoption.json`，用户确认整个精确计划后写入。已有项目始终 preserve-and-inventory；明确新建且适用 React/shadcn 才默认 shadcn-first。
3. 已有 AGENTS 原文保持。AGENTS.override.md、已有采用记录、未知 Foundation 标记或过长规则冲突时不覆盖、不自动拆分。上层与更深层规则仍可能影响宿主加载；记录不代表新对话已发现。
4. 正常开发先读代码与资产，确定全局或实例影响。资产使用 `asset-facts-batch` 封闭批次，页面可同批，关系沿用独立接口；每个批次完整确认一次，不逐按钮确认，也不发永久任务授权。

资产批次的 documents 为 `{kind, expectedSha256, upserts}`，支持 pages、components、interactions、motions、changes、design-tokens；sources 为项目相对 `{path, sha256}`，另有 scope 和 generatedAt。新增预览路由可同批提供 preview 的 expectedSha256、routes 与 assets，所有文件必须同时绑定 sources；原路由和资源保留。每个 upsert 的 implementationMapping 必须绑定源码文件；verified 项还需绑定 verificationEvidence 文件。新批次保留未提及记录与已有其他字段；校验引用和写前字节，失败从现有日志恢复。绑定报告字节不证明报告结论或真人通过。

## Skill、更新与停用

盘点 CLI 使用 project inventory --project <项目> --root <安装根> 时返回同一 effectivePolicy。未提供安装根的旧 inventory 只执行保留式盘点，其 policyScope 明示不是有效项目策略，不能拿它覆盖已采用的策略。

预览配置不是无关资产维护的必要条件。没有预览时不传 preview，仍可登记实际应用页面/组件与源码证据；这不表示工作台预览已接通。要新增预览配置时另行确认 includePreview:true 的准备计划；已有不兼容配置不转换、不覆盖。有效策略统一取 rules inspect 的 effectivePolicy，含当前/采用规则版本、来源身份和例外；历史 identity.uiPolicy 只作历史记录，不抢先影响当前标签或复制内容。未采用、事实不完整时不可宣称制作就绪。

Skill 是薄入口，读取当前规则，不在全局目录复制完整正文。注册仍为独立确认；完整归属于同一安装且两文件未改动时可在当前 capability-register 计划中精确刷新。不属于本安装、用户改过、缺文件或归属损坏时停止并保留。刷新采用现有能力写前日志，中断时按 capability-recover 的新确认计划恢复，不手动覆盖。源码更新不等于用户级副本更新；注册文件存在不等于宿主发现。

兼容规则更新读取 current，不覆盖项目例外；不兼容主版本/采用格式保持只读，需要另行迁移设计与批准，当前不自动迁移。旧项目计划在 current 改变后失效。第一次升级仍由旧安装引擎执行，不能倒改旧 UI。

停用/卸载后项目指引因失效绑定惰性，不触发扫描或重装。项目 AGENTS 中的短入口、采用记录、用户例外和事实保留；它们不是常驻服务，也不是剩余安装成功证据。需要删这些项目资料时另行明确范围。普通卸载保留未知、修改文件和项目代码。

真人验收使用没有建设历史的新对话：先自然请求打开 Foundation、查看指令，再在明确项目里完成真实开发。主动完成告知必须在用户不追问时实测；工程脚本轮询不能替代。
