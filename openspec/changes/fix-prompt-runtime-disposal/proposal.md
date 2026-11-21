## Why

组件释放资源一次。

## What Changes

组件可重开，宿主正常退出，无 database is not open 或残留监听器。

## Capabilities

### New Capabilities

- `component-resource-disposal`。

### Modified Capabilities

无。

## Impact

文件库组件及 Electron 宿主。沿用既有组件 ID、用户资料与动作协议。
