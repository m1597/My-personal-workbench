# Proposal

## Why

用户希望每天按自己的偏好选歌，核对实际版本后试听，只保留喜欢的录音。首个业务组件需要验证公共宿主在真实媒体播放中的连续性。

## What Changes

- 启用第一方音乐组件，支持独立启动及工作台停靠。
- 增加按日期保存的推荐、版本匹配、试听缓存和批量入库。
- 用合成录音贯通离线流程；真实模型和来源按用户提供的权限逐项接入。

## Capabilities

### New Capabilities

- `music-audition` 管理推荐、录音版本、试听与个人音乐库。

### Modified Capabilities

## Impact

影响公共宿主、工作台布局识别、独立组件部署和桌面启动器。SQLite 由 Electron 内置运行时提供。
