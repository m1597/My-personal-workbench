## Why

用户在独立或停靠的提示词仓库中都需要查看组件连接，同时知道固定动作由工具集使用哪个连接执行。

## What Changes

增加主动打开的组件设置页，接入工作台共用的配置读写和变更通知。在固定动作入口显示实际执行用途、连接和模型。

## Capabilities

### New Capabilities

- `prompt-api-settings`：仓库设置与委托执行状态。

### Modified Capabilities

无。

## Impact

提示词仓库可信宿主、专用 preload、组件视图。依赖 share-component-api-connections 与 configure-toolkit-model-routes。
