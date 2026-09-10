# Foundation UI Engineering Standard v0.1

管理中心工作台采用 React + Vite + Tailwind CSS v4 + shadcn/ui `base-nova`。`src/components/ui/` 只保存 registry 基础组件；Foundation 特有组合进入 `components/foundation/` 或 `features/`。业务层不得为了局部布局覆盖 registry 源码。

## 组合规则

- 操作控件使用 `Button`，选项集使用 Base UI `Select`，模式与面板页签使用 `Tabs`；Select 保留 portal、flip 和 collision padding。
- 停靠信息区直接使用工作台面板表面，不额外套 Card；悬浮信息区以完整 `Card`/`CardHeader` 形成独立浮层。滚动内容使用 `ScrollArea`，空内容使用 `Empty`。
- `Resizable` 只负责工作区停靠分栏；悬浮面板的二维拖动和四角宽高缩放由 context-panel feature 管理并使用同一个 workspace state。
- 图标来自 `lucide-react`。图标按钮统一使用 Foundation IconButton 组合，具有 `aria-label`、`title`、`Tooltip` 和既定 Button variant，不使用 Unicode 或手写 SVG。
- 主题使用 shadcn 语义 token。023 起由 Tailwind v4 `--font-sans` 统一启用已打包的 Geist Variable，并按字符回退到平台本地 PingFang SC 或 Microsoft YaHei UI；不得在 body、页面或组件实例维护第二套字体栈。

## 状态与层级

`src/state/workspace-state.mjs` 是唯一状态源码。预览 iframe 通过页面 route 和 `postMessage` bridge 与工作台同步；消息必须同时通过 namespace、允许 origin 和 iframe `event.source` 校验。

悬浮面板作为 `.workspace` 直接子树渲染，不保留右侧分栏占位。顶部 16px drag strip 是二维拖动区域，四角透明命中区负责宽高自由缩放；面板内容超出当前高度时裁切，不引入悬浮内容滚动条。

停靠面板工具栏高度等于 `--workspace-toolbar-height`，与预览工具栏对齐。Tabs 与内容区之间不新增分割线；分栏 handle 的可见宽度为 1px，扩大命中范围不得显示额外握柄。

最小化独立于停靠/悬浮模式。恢复控件是 `.workspace` 的绝对定位子元素，可拖动；单击恢复，拖动不得误恢复，恢复后回到最小化前的位置模式。

## 工作台内容尺度规范

业务内容统一遵循 `FOUNDATION_SHADCN_TYPE_SPACING_GOVERNANCE_V01.md`。页面级 `--space-*` 已废弃；页面与详情使用 Tailwind `p-6`/`gap-6`，面板与卡片使用 shadcn 默认值或 `p-4`/`gap-4`，控件组使用 `gap-2`，微型元数据使用 `gap-1`。

工作区高度、浮层拖拽缩放、React Flow 画布与 iframe 设备尺寸属于命名几何，不得扩展成通用间距或字号变量。registry 组件内部以当期 shadcn 官方源码为准。

## 020R1 治理边界

`packages/core/ui-policy.mjs` 是 Foundation 通用 UI 策略的机器可读权威，并由新项目 facts 生成、现有项目 inventory、Codex context、UI audit 与合同测试共同消费。通用策略只规定 shadcn-first、preserve-and-inventory、已安装 preset、现有组件与 variant 优先、外部布局边界、例外登记以及依赖升级授权，不携带管理中心的具体布局。

`apps/management-center/src/foundation-ui-profile.mjs` 仅描述管理中心体验：顶栏显示真实项目名、现有导航顺序与行为、预览/侧栏关系、检查对象层级交互、悬浮与停靠内容一致性、React Flow 页面卡片行为和工作区命名几何。这些决定不会自动传播到其他 Foundation 项目。

顶栏项目名来自 `workspaceModel.project.name`，单行截断并提供完整可访问名称；导航仍按“预览搭建 → 逻辑搭建 → 资产管理”排列且保持原状态映射与窄宽横向溢出行为。019 Result 中隐藏项目名的结论是历史快照，已被 020R1 的最新用户决定取代；历史报告本身保持不变。

React Flow 是已登记的 specialist engine。`.page-flow-node`、节点、handle、edge、label、background 与 engine controls 的内部字号、间距和几何由其专用 contract 管理；toolbar、Button、Dialog、Field、Select、侧栏和反馈等外围普通 UI 继续使用 shadcn。

## 023 跨平台字体边界

普通 UI 的拉丁字母和数字使用 Foundation 已有的 Geist Variable；macOS 简体中文使用系统本地 PingFang SC，Windows 简体中文也优先引用系统本地 PingFang SC，缺失时依次回退到 Microsoft YaHei UI / Microsoft YaHei。启动时在 React mount 前写入只读 `data-font-platform`，只调整同一个 `--font-sans` 的平台候选顺序；它不读取字体目录、不安装字体，也不参与明暗主题。Apple 与 Microsoft 字体都只按 family 名称引用，不进入源码、dist、安装器或依赖。标题、正文、辅助信息和原始数据分别通过共享内容角色或本地 shadcn primitive 使用语义字号、字重与 leading；中文和中英混排标题不默认使用负 tracking。

新项目默认采用这项通用 policy；已有项目仍执行 `preserve-and-inventory`。React Flow 内部 typography 继续由已登记的 specialist contract 管理，023 不改变节点、边、画布或 engine control 的专用字号与几何。
