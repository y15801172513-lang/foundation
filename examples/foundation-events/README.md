# Foundation Events

Foundation 的受管理验证项目，用于验证页面、关系、事件状态、组件变体、实例和工作台上下文闭环；不是安装版本或真实客户项目。

```sh
npm run build --prefix examples/foundation-events
./foundation-kit verify ./examples/foundation-events
./foundation-kit center ./examples/foundation-events --port 4317
```

运行数据只保存于浏览器 `localStorage`；管理页可恢复演示数据。`.foundation/facts/` 只描述项目页面、关系、组件和实现，不保存事件运行数据。
