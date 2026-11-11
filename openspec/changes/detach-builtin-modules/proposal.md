# Proposal

## Why

桌面工作台的四个内置模块只能在 Dockview 内重排。用户需要把任意模块拖到工作台之外单独使用，也能让四个模块同时占用四个独立系统窗口。

## What Changes

- 模块 1 至 4 和示例组件使用一致的拖出、中央合并和四边分屏手势。
- 每个模块可通过桌面入口单独启动，工作台关闭后独立窗口可继续使用。重复打开定位到现有实例。
- 分离和接回保留模块已有操作状态，四模块的窗口可以独立移动、缩放和关闭。

## Capabilities

### New Capabilities

- `builtin-module-windows` 管理桌面工作台内置模块的独立启动、多窗口共存及双向停靠。

### Modified Capabilities

## Impact

涉及桌面 CMD、公共宿主、受限 preload、模块导航和面板信息、Dockview 布局读写与隔离 profile 测试。桌面运行时继续使用现有 Electron、React 和 Fluent。独立安装分发属于后续产品阶段。
