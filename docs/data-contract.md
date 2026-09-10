# Data contract

项目 `.foundation/foundation.json` 保存项目身份和 `dataFormatVersion`；`.foundation/facts/*.json` 是长期事实权威。每个 facts 文档包含 `schemaVersion`、`kind` 与 `items`，共同字段为 `id`、`status`、`source`、`updatedAt`、`verificationStatus`。未知使用 `unknown`，推测使用 `inferred`；稳定 ID 不因名称变化而改变。

`verify` 除共同字段外执行确定性交叉校验：

- 每个 facts 文件内 ID 唯一；存在页面时恰有一个 `entry=true`。
- relation 的 `from`、`to` 必须引用存在的页面。
- component usage 的 `pageId` 必须存在，family/variant 必须由当前组件事实声明。
- 每个页面的 `preview` 必须在 preview route 中声明。
- 错误包含文件、字段位置和不存在的引用对象，不静默修正事实。

## Preview 配置

`.foundation/preview.json` 不属于 facts，不保存页面身份，只保存本地访问映射：

```json
{
  "schemaVersion": "0.1.0",
  "mode": "local-static",
  "routes": [{"path": "/home", "file": "home.html"}],
  "assets": [{"path": "/src/app.mjs", "file": "src/app.mjs"}]
}
```

`path` 必须是规范化的根相对 URL，route 与 asset 之间不得重复。`file` 必须是项目内相对普通文件；绝对路径、`..`、缺失文件和解析后通过 symlink 逃出项目根的文件均拒绝。未声明 URL 返回 404。缺失或非法 preview 配置使 `verify` 失败，不回退到 Button 演示。

生成的 HTML、管理中心 view-model 和构建产物都是展示或运行层，不能反向覆盖 facts。
