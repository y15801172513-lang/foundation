# Changelog

All notable changes to AI Product Foundation Kit are documented in this file.

## [Unreleased]

## [0.2.0] - 2026-08-30

### Added

- 新增机器可读的 Foundation UI policy、Management Center 产品级 UI profile、依赖声明审计与 UI 治理审计。
- 检查对象层级支持逐项选择、预览位置联动、展开状态保持、滚动位置保持和技术标识 Tooltip。
- 新增内容角色组合与静态合同，覆盖页面标题、面板标题、正文、说明、Meta 与代码文本。

### Changed

- 将 Base UI、React、Lucide、Tailwind、Vite 与测试运行时升级到当前 Node 20.19+ 支持范围内的最新版本。
- 统一根 workspace 的 Vite 8 解析，并补齐 Base UI 1.7 所需的 jsdom 浏览器 API 测试夹具。
- 管理中心与 `foundation-events` 统一使用 shadcn/Tailwind 内容角色字号、间距与语义颜色，废弃页面级 `--space-*`。
- 为 UI 治理增加机器可读审计、静态合同和逐文件 shadcn registry 差异处置。
- 顶栏恢复可截断的项目名称，并保持原有导航分区、顺序和状态映射。
- 侧栏与资产详情统一采用 shadcn Tabs、Tooltip、Select 和语义 token；React Flow 内部维持登记后的专用引擎边界。

### Fixed

- 移除未分层全局边框颜色覆盖，恢复 Tabs、Button、Input、Textarea、Select 与 ScrollArea 的 shadcn 状态样式。
- 修复停靠/悬浮检查面板切换后的定位、内容一致性、树展开状态与各标签页滚动位置。
- 修复层级树行对齐、缩进、叶节点点击、选中态与预览悬浮定位反馈。
- 修复资产预览变体控件对齐、冗余标签，以及长标题和技术身份信息的单行省略与完整 Tooltip。

## [0.1.0] - 2026-08-29

### Added

- Foundation 管理中心，统一承载预览搭建、逻辑搭建和资产管理工作区。
- 基于真实 facts 的页面关系画布、关系编辑与可恢复写入流程。
- 页面逻辑侧栏、预览对象检查器、层级定位及上下文复制能力。
- 资产筛选、真实隔离预览、技术信息和使用位置投影。
- `foundation-events` 验证项目及固定本地预览入口。
- shadcn/Base UI 组件基础、语义颜色 token 和 Foundation 工作区布局 token。

### Changed

- 管理中心顶栏使用 Navigation Menu 统一入口，并移除可见项目身份块。
- 预览、侧栏、悬浮面板、检查器和 React Flow 控件完成 R1 稳定化。
- 组件、页面、事件、关系和资产统一使用稳定身份与结构化上下文。

### Fixed

- 关系并发写入、版本冲突恢复、非法路径与来源验证。
- 检查器默认对象、滚动容器、悬浮面板单轴缩放和工具栏固定行为。
- 预览进程身份、健康检查与未知端口占用保护。

### Known limitations

- Codex 内置浏览器验收在当前 Windows 环境仍可能被 `EPERM` 权限错误阻断；自动化测试与生产构建作为本版本的主要验收证据。
- 管理中心保留少量经登记的 Vite 兼容层与裁剪 API 包装；使用中的样式和行为已对齐当前官方 registry。
