## Why

原生选择框的展开按钮和弹出的列表分别由两个绘制系统负责。Music 的原生子视图高于工作台 DOM，原遮挡逻辑在设置展开期间清空整个可见槽位。

## What Changes

- 工作台设置和布局使用公共 Fluent 选项列表。
- 首次和恢复默认使用 100% / 100% / 100%，读取已有偏好沿用原键。
- 停靠组件接收三个材质参数，展开设置期间工作台合成同一运行视图的画面。

## Capabilities

### New Capabilities

### Modified Capabilities

- `workspace-components`：工作台设置可在停靠内容上方使用，停靠组件与工作台共享展开态材质。

## Impact

涉及宿主、专用 preload、工作台渲染层、公共主题与 Electron 交互验证。
