# Foundation 制作规范

规则版本与适用数据格式以同目录 manifest.json 为准。这是使用 Foundation 制作用户项目的规则，不是制作 Foundation 本身的发布流程。规则文本不授予文件权限或执行批准。

## 开始：从真实项目决定适用性

同任务已经明确打开/开启/使用 Foundation 后，后续相关制作默认延续这个选择；不要再次询问是否用 Foundation，也不要静默转向独立 HTML 或另一交付渠道。用户明确退出或改选优先；帮助、引用、否定、普通 fd 搜索及无关请求不触发执行。其他 Skill 可以辅助制作，不能替代项目管理与交付关系。打开页面不等于接入批准；工具已打开、项目已选择、已接入、规则已就绪必须分开说明。

只使用用户明确的业务项目根。多项目、嵌套目录或当前目录混有安装/缓存时先问缺失的位置，不猜整个沙盒。明确新建根后准备新项目计划；已有可运行项目保留代码与技术栈。项目已就绪直接工作，未就绪主动组织必要计划，只询问真正缺少的位置或精确变更批准。关闭页面、停止预览不等于停用。跨任务通过既有 binding/adoption 与惰性 AGENTS 指引读取当前规则；不增加全局开关，不改用户规则来强制接管。

首次接入在同一管理器页面披露精确项目、补齐缺项、技术栈采用及持续同步范围。通过 enable 的 continuousSync:grant、technology:preserve（适用且明确的新 React 项目才 react-shadcn）及明确 includePreview 生成精确计划，由本人一次确认。后续步骤同页自动接续，已完成步骤核实后跳过；失败保留前序结果。旧 enabled 不等于持续授权，已有项目只补一次明确授权。保留原源码、事实、用户指引及例外。

预览是可选接入能力，不是资产维护的隐含前提。未接预览时，asset-facts-batch 不传 preview；原应用的页面/组件仍可登记，不能把登记说成可预览。首次已披露预览准备则自动完成；新增未授权预览能力时独立确认配置，不把非静态项目强制转为 local-static。当前策略只取校验后的 effectivePolicy（当前规则/采用版本、安装身份、例外），不优先读取历史 identity.uiPolicy；已有项目不得因更新迁移技术栈。

读取当前项目的用户要求、AGENTS、技术栈、已有代码和已登记事实，再确定最小任务及写入边界。已有项目默认 preserve-and-inventory：保留框架、组件、样式、目录和用户约定，不为了接入 Foundation 迁移到 React 或 shadcn。新建且适用 React/shadcn 的 UI 默认 shadcn-first；用户明确指定其他栈优先。空的 Foundation 事实骨架不等于新建 React 产品。

先检查已启用的项目绑定和当前安装规则；缺失、停用、移动、安装失效或版本不兼容时，Foundation 指引保持只读。可以解释普通开发需求，但不能声称按已启用 Foundation 完成维护。项目采用记录与用户例外独立保存，升级不得覆盖它们。

## 复用、结构与修改传播

先查现有基础组件、variant、composition 和真实使用处，再决定复用、受控扩展或新增。内容、数据和单个实例属性不同不构成新组件。多个位置复用的有意义视觉/行为差异用 variant；由稳定基础能力组合的模式用 composition；只有职责独立且无法合理复用才新增。一次性局部样式可作为有理由、有范围的例外，不强行建库。

修改前说明范围：基础组件影响所有实例；variant 影响选择该变体的实例；composition 影响组合使用处；实例修改只影响指定实例。从代码搜索真实引用，不从“同名”推断共享。若用户目标只是一处，不悄悄改基础组件；若目标全局，不复制局部补丁。验证所有受影响使用处及至少一个不应受影响处。

页面负责组织和布局，交互逻辑负责状态与转换，数据层负责对象、读取和持久化。不要将这三者混成难以定位的大文件，也不为拆分而增加无用层。准确位置至少包含项目、页面/路由、组件或对象、实例/变体及源码定位。

第一版即使仅一行文字，也必须从实际实现提取适用的文字/背景颜色、字号等基础变量，真实引用并登记值、源码与使用关系；不得以空表或闲置声明交付。不机械变量化所有数值或虚构不存在能力。样式优先项目已有 token 和局部基础控件；颜色、间距、字号不因一次需求散落复制。确需偏离时记录原因、位置、范围和验证，不覆盖其他项目的 token。Foundation 自身的字体和 shadcn 制作细则不是所有用户项目的强制前提。

交互和动效先查现有实现。明确触发、初始/进行/完成/取消/失败状态、打断与恢复、键盘和减少动态效果需求。可复用行为以真实模块被至少两个使用处调用；登记名称或复制相同代码不证明复用。未知参数标记待确认，不虚构已获用户认可的时长或曲线。

## 实现、事实与证据

运行源码是实现证据；.foundation/facts 是项目身份、关系、映射与验证记录的权威，生成 HTML 不是反向写回的来源。读取当前事实和对应源码之后再生成维护批次。自动发现仅为候选，未确认的页面关系、对象职责或运行行为不得写成已验证。

每个批次列明文档摘要、精确记录、源码位置与摘要、影响范围和保留项。持续授权有效时通过 project sync --root <安装根> --project <精确项目> --payload <项目内批次文件> 自动提交封闭 handler，日常同步确认次数为0。保留原精确计划、互斥、写前快照及日志，不伪造本人确认，不手写 facts 绕过产品。超出范围另行确认；源码修改仍受用户任务授权。

组件/交互/动效/变更记录必须有稳定 ID、可解析的项目相对源码位置和明确验证状态；关系引用真实存在的对象。批次提交前重核文件摘要，冲突刷新后重建计划，不能覆盖未知修改或重放旧确认。失败先看同次操作记录和恢复状态，不能将部分事实落盘写成全部完成。

## 完成、更新与停用

交付链为源码修改→受影响事实/关系批次→本次需要的预览映射→只读一致性检查→同项目工作台重开。用户要求在工作台看可视页面时，预览接入是本次交付条件；无法支持时明确未完成，不以“预览可选”改用独立网址冒充工作台交付。一般无预览项目仍支持事实维护，不强制转换技术栈。

用稳定入口 project delivery-check --root <安装根> --project <精确项目> --changes-json <本次变化数组> 核对，视觉工作台交付加 --require-preview。数组由执行任务生成，不要求用户填 JSON：每项 path 为项目相对源码路径，sha256 为当前字节摘要，删除为 null；改名列旧路径删除与新路径。程序只检查字节、引用和静态预览配置，不证明业务语义或浏览器运行通过。旧记录缺摘要保持待核实，以精确事实批次补充，不自动认定新摘要可信。

asset-facts-batch 将验证后的 implementationSha256 保存到对应事实。删除/改名可在同一精确批次使用 documents.removes（记录 ID）和 preview.removeRoutes/removeAssets（公开路径），同步受影响引用；只删除登记，不删除用户源码。取消或失败后保留代码，报告“代码完成，Foundation同步待完成”，重新检查可读回缺口，不循环弹确认、不重放批准、不自动回滚代码。外部修改后重新检查摘要，每个任务开始、修改完成及打开工作台触发 project sync；任务无需再次提及 Foundation。外部变化下一次触发自动发现，未知语义登记待核。没有运行进程时不能声称即时处理。

交付回答：改了什么、准确位置、复用/传播范围、验证了什么、未做什么、下一步。至少验证真实启动、相关交互、保存后重开、受影响/未受影响位置及基本窄屏可用性；声明式页面、截图、文件存在、exit 0 均不独自证明功能闭环。工程夹具与真人反馈分开。

程序版本、规则版本、项目采用格式、数据格式分别记录。新任务从稳定安装入口解析 current，不能固定旧版本规则目录。规则主版本不兼容、项目采用格式未知或 current 在任务间改变时停止旧规则执行，重新只读核验；需要迁移时独立展示计划，不自动覆盖项目例外。更新失败保留可恢复版本和项目资料。

停用只使 Foundation 项目指引失效，保留源码、事实、用户例外与未知文件。卸载仅处理精确归属的运行内容；无法核验的文件和项目资料保留并披露。缺安装或失效绑定不能凭残留指引自动重装、扫描或重新启用项目。

## 持续同步与内容交付（041）

授权状态为未授予、有效、已撤销；同步状态为最新、待同步、进行中、失败或冲突。关闭面板、停止预览、结束对话不撤权。明确停用走 disable；仅撤销同步通过 enable 计划 continuousSync:revoke，保留面板与资料。撤销后排队批次拒绝，已提交结果保留；打开不自动恢复。

旧 changes.deliveryScope（schemaVersion 1.0.0）保留原语义；新任务使用下节 2.0.0。旧格式包含 requirementSource 和 items；每项有 id、source、description、factIds、applicability、content/mapping/runtime 及 evidence。不适用需 state:not-applicable、reason、source；不得仅从旧 facts 反推范围。组件登记用途与真实 usageLocations；多表现才登记 variants，无变体明确不适用；内联对象可映射文件与位置，无需强拆。页面内交互记录 pageIds 或明确跨页范围、trigger、initialState、targetState、description。首页是应用入口，无导航或状态可明确不适用。

共享 contentIntegrity 发现缺口允许保存草稿，但阻止交付就绪。consistent 仅表示字节与引用一致，不代表内容覆盖、运行或真人验收。真实独立预览导入当前组件，保留隔离合同；缺适配器、超时或失败须可见并可重试，不复制假 HTML，不放宽 sandbox。

## 声明级复用与交付（046）

任务开始恢复当前需求和 scope revision，查现有 definition、usage、variant、composition 与源码引用；用 project analyze --root <已核验安装根> --project <精确项目> --entry-roots-json <明确入口数组> 取得只读观察。按 same-instance、variant、composition、base-update、new、local 或 not-asset 记录决定、检索范围、候选与拒绝理由。new 必须说明已有资产为何不适用。用户无需选择工程术语。inventory-only 不授予重构许可。

在已有开发授权内修改实际代码；新增用法必须调用原定义，内容通过 props/slots 传入。修改后再次分析并对照决定，复制声明或未出现预期调用为 decision-not-applied；动态 registry、HOC 与未支持语言保持 unknown。import-only 和 preview-only 不算业务渲染。重命名保留 Facts ID，使用位置唯一存于 usageLocations，implementationInputs 只存技术影响边。

通过唯一 asset-facts-batch 提交 assetModel 1.0.0、deliveryScope 2.0.0、reuseDecisions 及精确证据索引。scope 包含需求来源、修订、交付类型、深度、尺寸策略、包含与排除项和分维证据要求。结构草稿可保存，非法引用、路径与坏报告拒绝；旧记录无新模型为 legacy-unreviewed，不自动升级 verified。冲突重读形成新计划，不能重放旧 payload。

源码字节一致、同步最新与验收完成分别报告。交付的 scope/content/definition/runtime/layout 全部必要维度通过或有来源的合法 N/A 才可整体通过。导入报告是 external-unverified，producer 或自填 verified 不产生运行证明。CSS/token、组合、适配器、任务修订、环境与构建变化需要复核受影响证据。查看缩放不改变业务视口；不支持的 renderer 标 blocked。完成时重开同项目工作台，核对完整 revision、当前选择及应改变和不应改变的位置。

分析默认载入 ES2020 标准库，项目明确声明的 compilerOptions.lib 优先；平台类型、外部依赖、extends 和插件未加载时显示诊断与 partial，不执行配置插件。分析仅在明确任务节点调用；缓存位于安装拥有的 state/analysis-cache，每项目索引最多 16 MiB，普通 GET 不分析。精确批次的 analysis.before/after 使用两次 project analyze 原样返回的 observationReceipt；修改后收据与当前字节不符则重分析，不能手填或重签。

assetModel.states 使用 id/trigger/recovery 描述状态与恢复。previewScenarios 明确 definition/composition/instance 及 adapter，不能借工具栏冒充 Button。本体无独立适配时使用页面内查看。配置轴、状态与实例分别登记。

project verify-definition --root <安装根> --project <项目> --entry-roots-json <入口数组> --task-id <任务> --requirement-id <需求> --asset-id <资产> 只验证静态定义。Web 范围可在 items.browserChecks 声明有限的 visible/text/attribute/css/count/click/fill 检查，再用 project verify-browser --root <安装根> --project <项目> --task-id <任务> --requirement-id <需求> --asset-id <资产> --scenario-id <场景> 运行当前 Chrome/CDP。缺工具为 blocked；不因此安装浏览器。运行返回 reportText 与摘要，由当前任务在已有文件写入权限内保存到项目相对报告路径，再通过原 asset-facts-batch 绑定 sources 和 evidenceIndex。报告只证明所声明检查，不证明未声明行为或真人接受；scope/content 使用下述受控语义核验流程，不以自填 verified 代替。

本合同最小能力为 descriptor.factCapabilities 中的 component-delivery/1，不以旧程序版本号推断支持。迁移使用同一精确批次，计划列出影响、文档前后摘要，恢复沿用原事务的前像；保留 ID、描述、例外与旧证据。受管更新/回退遇目标缺能力时拒绝；用户字节漂移后不覆盖恢复。

删除验收需要当前 descriptor 的 `deletion-review/1` 能力；受管更新/回退到缺此能力的运行时必须拒绝。删除已观察的实现输入时，在当前需求项的 `removedInputs` 列出精确 `path`、删除前 `beforeSha256` 和本项 `sourceRefIds`，先同步清除失效事实与预览引用。保留或替代的页面/组件完成当前定义、运行和语义核验后，受控语义计划逐项审阅删除依据，原同步事务才能接受缺失路径。仅文件消失、旧成功报告或自填 null 不代表接受；文件重现、来源变化或残留引用仍拒绝。没有可验证的保留/替代对象时维持待核，不用空范围冒充删除验收。

### 受控语义核验（semantic-review/1）

需求 sourceRefs.ref 使用项目内需求记录的精确位置，例如 requirements.md#L1-L6。该记录保留用户原文、来源和未确认项，不把推测改写为用户批准。完成定义与浏览器核验后，将各自 reportText 保存并经原 asset-facts-batch 持久化 evidenceIndex。

1. 运行 `project prepare-semantic-review --root <安装根> --project <项目> --task-id <任务> --asset-id <资产> --requirement-id <需求>`，保存完整输出为计划文件。准备路径读取当前范围、需求行、实现和实际证据，返回签名计划及固定检查项。未确认来源、缺运行证据或失效输入不签发可用计划。
2. Codex/审阅者实际阅读 plan.sources 的原文、plan.implementation 和所引用报告；逐项判断落实、变化依据、内容深度、失败恢复及应保留内容。创建 schemaVersion=1.0.0、planDigest、reviewer(kind/label/source)、checks 的审阅文件。每个 check 保留计划的 id/expected，填写 observation、judgment(passed/failed/pending)、rationale、coveredFactIds、evidenceIds、sourceRefIds、limitations。不可从期望自动生成成功观察。
3. 运行 `project submit-semantic-review --root <安装根> --project <项目> --plan <准备输出文件> --review <审阅文件>`。程序重读当前输入、检查引用和完整覆盖，按逐项 judgment 聚合；过期计划或额外 verified/producer/result 字段拒绝。收据只证明输入绑定和执行路径；reviewer 是如实自述，不是身份认证，也不证明语义一定正确。
4. 保存返回 reportText，按返回摘要加入 sources，以 semantic-review 类型加入原变化记录的 evidenceIndex；维度为 scope/content，保留原 definition/runtime/layout 证据，用同一精确 asset-facts-batch / project sync 保存。然后运行 project delivery-check 并重开工作台，核对全部必要维度与 aggregate。真人接受始终独立，不因工程审阅通过而改变。

静态营销和明确展示需求可以通过相应深度检查；不能把无操作的按钮评为业务成功。预约需阅读并实际验证约定的失败/恢复；局部修改须核对未改变的二级内容。语义报告依赖的需求文件、定义、样式、运行报告或范围发生变化后，必须重新准备、读取和核验。旧候选缺 semantic-review/1 时受管兼容门拒绝该事实合同。


## 自动结构整理与身份核对（047）

每个相关任务开始、每轮完整修改后、交付前均调用受控 project sync。程序按真实源码补充同一 facts 中的 sourceStructure：结构、包含关系、源码位置与事件/字段绑定候选；这不是业务语义验证。返回 coverage.missing/stale 或 semanticPending 时继续核对需求、实现和精确批次，不能以文件已登记、命令成功或面板能显示结束制作。外部无 payload 发现只标候选；无进程期间下次任务补查，不承诺后台监听。

语义审阅计划逐项包含独立源码清单中的对象，不限于调用方已提交 factIds。核对需求原文、内部区块、实例、字段、状态及操作影响；无二级页只说明导航范围，不豁免内部关系。共享规范与实例变化分别按实际引用传播；保留未知、用户例外和既有事实，不把实现自动升级为规范。

预览桥接的产品模块是 packages/core/preview-bridge.mjs（工程载荷 artifacts/preview/preview-bridge.mjs），静态页面以 ES module 接入，React 在挂载后创建并在清理时 destroy。bindPreviewContext(window,{pageId}) 明确页面身份；父工作台传入 projectId/revision/channel/pageId。完成实际 DOM 后调用 announcePreview；createInspectorBridge 响应状态探测、检查选择与失效。普通桥接仅声明页面与对象检查能力，独立资产场景仍需既有隔离适配器，不能用隐藏其他页面区域冒充独立定义。

显示名称优先 data-foundation-label，其次有效无障碍名称，再用语义角色或中性结构名；不使用整段正文或待命名占位。基础名最多20字素，消歧名称最多28字素，正文摘要最多80字素，实例键与身份独立展示。装饰保持原字符和 aria-hidden，需命名时使用源码语义标注，不为检查器添加读屏名称。持久标识使用显式 data-foundation-object-id，复用既有组件/实例标识；重命名、移动时保留 ID，删除不复用。data-foundation-source 提供源码位置；动态重复对象无持久 key 时保留 session/revision 临时句柄，不承诺跨刷新稳定。复制内容必须保留身份类型、修订、来源和缺口；仅名称相似是关系候选。

交付统一 assessment 派生结构覆盖和可视任务必检维度；旧收据缺工作台握手、定位、重开或适用资产 ready 时维持待核。配置存在不等于运行通过；不能通过遗漏 browserChecks、require-preview 或填 N/A 让已实现页面整体通过。静态结构和受控观察分别报告，真人接受及新任务自然发现独立留门。

纯静态页面可用 verify-definition 的 --asset-id <页面ID> 绑定当前 HTML 文件；verify-browser 使用同一页面 ID 加 --scenario-id page。页面预览不强制伪造可复用组件或独立资产场景。声明核验只证明精确页面文件绑定，语义与运行各自独立。

独立资产使用同一产品载荷的 asset-preview-bridge.mjs：先在独立入口挂载实际定义或实例，再 createAssetSceneBridge({root,definitionId,scenarioId})。根标注 data-foundation-component-id、data-foundation-scene，实例另给 data-foundation-instance-id；只发送 ready 不足以通过，验证器同时检查隔离 frame 中实际匹配且有尺寸的唯一场景根。缺少独立入口时明确 unsupported，不隐藏整页的其他区块充当场景。

### 当前任务、语义关系与身份世代（047R1）

当前验收以本次任务引用和实际实现依赖判断是否可视，不因项目有页面或历史任务是 web 而强加预览。非可视项的 not-applicable.source 必须对应本次 sourceRefs 中已确认的精确来源；把实际受影响页面省略或改写 platform 不能豁免。旧项目范围不因此自动升级。

业务意义由 Codex 实读需求和实现后写入原 sourceStructure.semantics：nodes 使用 region/component/instance/field/state/interaction/data/token 类型，保留 id、name、objectIds、sourceKeys、sources；relations 使用 contains/uses/triggers/data-affects/transitions/styles，端点引用节点 id，同样绑定 sourceKeys 和当前 sources 的 path/sha256。sourceKeys 来自独立结构与事件/状态分支清单；不得机械将全部源码键塞给任意关系来冒充语义完整。缺分支、缺边、端点失效或旧来源不能进入语义通过。关系面板和对象上下文读取这一份事实；登记关系仍是 recorded-not-reviewed，只有当前受控审阅可以提供验证证据。

sourceStructure.identityHistory 随同一批次保留对象世代和删除墓碑。只有当前工作台快照传入匹配世代的对象才可跨修订重解析；无世代的旧上下文只能在原修订解析。已经观察到删除的 ID 再出现必须生成新世代；两个同步观察之间发生且没有任何身份变更标记的删除重建无法由快照证明，不能宣称已解决这种不可观察复用。

独立 React/静态场景可调用 asset-preview-bridge.mjs 的 mountAssetScene({definitionId,scenarioId,instanceId,render})。入口必须是空白文档，render(root) 挂载实际导出的定义并返回清理函数；React 使用现有 createRoot(root).render(...)。程序创建场景根、等待渲染后执行标准桥接。不得把整页先挂载再隐藏其他区块；保留原栈，不引入依赖或改真实存储。此挂载入口不替代候选中的实际浏览器及定义/实例绑定验证。


### 047R3 连续观察与身份接续

已获得持续同步授权后，任务开始、完整修改后和交付前调用普通 `project sync`，程序保留上次完整观察与跨轮未验收变化；同步或开始新任务不等于接受变化。当前任务通过与项目整体通过分别读取同一 delivery-check。需要明确编辑范围或身份意图时，在业务文件编辑前调用 `project sync --round begin --task-id <当前 changes ID>`，完整一轮编辑后调用 `project sync --round finish --task-id <同一 ID>`；交付前读取统一 delivery-check。程序枚举实际新增、删除、修改及资源，调用方 changes/factIds 不能替代枚举。中断保留起点；不得在编辑后伪造编辑前基线。没有运行进程时不承诺监听，下次任务必须补查。

普通同步会提取 HTML 结构、直接弹窗事件及 React useState/直接 setter/条件渲染关系；多导出归属、动态事件、未知依赖和业务意义仍需精确批次补充，不能把 source-derived 当成验证通过。组件独立场景由当前导出声明、固定实例配置和源码摘要生成，任意 render 回调或自填 ready 不再证明当前组件。未知框架或顶层副作用保留 pending。

持久对象在修改前随 begin 提交 `--identity-actions-json`：create 创建不可复用 incarnation；retain 声明受控保留；move 明确新 owner 与 sourceFile；retire 明确失效。create 返回的 incarnation 写入 `data-foundation-incarnation`，对象或其祖先用 `data-foundation-owner-id` 明确 owner；两者均为源码语义标注，不改变 aria 语义。结束时程序核对来源。没有可观测连续性的外部重建必须失效，不能沿用名称或相同 ID 猜测。临时对象只能在 session/revision 内定位。

业务 semanticRevision、资源字节 resourceRevision、观察 observationRevision 分开。可以证明等价的 JS 格式变化保持业务版本；精确字节证据仍失效。资源字节不变时面板绑定新 envelope 并保留预览；资源本身变化时按新资源代重新加载。不得声称任意格式都能免刷新。


### 052 可移植检查与旧项目补齐

一次开启检查后，选择即释放捕获、保留对象并复制定位信息；复制失败可重试，不妨碍页面逻辑页签。名称不提供身份。跨浏览器复制使用 project/page/objectId/instanceKey/incarnation/contentVersion；session handle 仅诊断。保存任一类复制文本至当前项目内文件后，以 `project resolve-object --root <安装根> --project <项目根> --input <项目相对文件>` 只读补取当前关联源码及样式。resolved 对象、mapped 源码与实时 DOM 绑定分别报告；stale/removed/ambiguous 不得自动重绑或猜测。恢复在来源浏览器的明确项目与页面刷新重选。

程序 update 保留旧项目与绑定，不代表项目内旧 bridge 自动更新。旧项目先生成 `project inspector-plan --root <安装根> --project <项目根>` 只读计划，核对精确文件摘要、现有用户改动与未支持动态实例。源码写入依照现有任务授权；身份先用同一 sync round begin/create 生成 incarnation，写入精确标注，再 finish 同步，保留旧 facts ID 和已有 adoption 例外。项目 bridge 使用当前载荷 artifacts/preview 模块；旧副本只在核对精确差异后替换，已改写副本必须合并，不静默覆盖。

可视交付逐类对照实际实现：页面路由、组件真实独立场景、实际动效与重播/reduced-motion、变量值/样例/引用均提供证据。registered/configured 不是 ready；缺场景、映射或运行证明保持 pending，不隐藏漏登记资产。首版变量与旧项目补齐经相同 facts 事务保存，最终载荷重开核验传播。

#### 052R2 对象与资产完成责任

新制作、源码迁移与每轮同步均检查普通 JSX/HTML 子节点，不以组件根代替内部选中对象。源码节点身份与组件定义、实例键、出生世代、内容版本分别保留。静态调用点保存明确实例身份；重复模板只使用可核验的业务 key。没有 key 的局部模板单独列出原因和补齐方式，不阻断同文件其他定义与静态节点。禁止从 DOM 顺序、坐标或正文推导稳定身份。旧 temporary 信封信息不足时不能恢复原对象，也不能猜其源码。

Codex 对本次适用的页面、组件、动效、变量主动完成用途定义、真实引用与运行验证；无需用户逐项审核资产。组件验证定义及真实调用，变量验证声明、引用和实际使用值，动效验证实际触发与减少动态效果，页面验证正常操作和所需状态。复用依据说明本次定义边界与实际使用位置，变量不能套组件复用模板。正常交付先运行 `project verify-delivery --root <安装根> --project <项目> --task-id <任务>`，按当前范围主动枚举定义和全部真实场景；缺断言或场景时补齐并重试。返回的 verify-definition、verify-browser 真实报告随同一精确事实批次提交；不把 unverified 文本直接改为 verified。

可用资产与待处理记录分开显示，保留用户既有记录。缺证据由本次制作任务主动补验；失败记录明确影响、原因和恢复动作。源码或依赖改变后，只让受影响证据失效并重验。交付前重开同项目核对可用清单、用途、使用位置及真实样例；仍有适用失败时不能称交付完成。组件变体与变量模式分别显示；没有变体时隐藏变体专属区，保留有意义的基础预览。

交付读回必须使用 `project delivery-identity --root <安装根> --project <项目>`，将 projectId、真实 root、candidateHash、factsRevision、evidenceRevision 与实际工作台模型 deliveryIdentity 逐项比较。项目显示名相同不能替代路径核对；所有成果计数绑定这个元组。迁移中断时读取保存的精确计划及 begin 世代，逐文件只接受 beforeSha256 或已经完成的 afterSha256；其他字节漂移停止续写，不能重新生成身份掩盖冲突。
