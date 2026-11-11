# Proposal

## Why

用户希望直接播放已有音乐文件，并能在应用重启后找到相同的曲目及进度。

## What Changes

音乐组件默认显示可导入、搜索、重新定位和移除曲目的本地曲库。推荐试听与曲库共用播放栏，正式保存的录音自动进入曲库。

## Capabilities

### New Capabilities

- `local-music-library` 管理本地音频索引与共享队列。

### Modified Capabilities

## Impact

涉及私有 SQLite、音乐 preload、隔离会话、组件界面和桌面构建。
