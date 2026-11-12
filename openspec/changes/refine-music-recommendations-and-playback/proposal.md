## Why

连续生成时累计候选和技术报错挤占歌曲列表。播放时需要从后台找回原视图，并在 Windows 任务栏直接操作当前队列。

## What Changes

- 每次显示本批最多五首新歌，跨批去重，按文件哈希和音频指纹比对下载录音，优先显示可播放的录音；开放本批队列和失败详情。
- 收紧歌词开关、调整仅播放栏的展开位置，在窗口菜单找回后台会话。
- 改善桌面歌词的玻璃样式与位置恢复，为独立及停靠模式提供系统缩略图传输控件。

## Capabilities

### Modified Capabilities

- `model-recommendation`：本批推荐与持久去重。
- `music-pages`：本批下载、播放和失败说明。
- `music-controls`：紧凑播放栏、后台显示和任务栏传输操作。
- `desktop-lyrics`：歌词外观与浮窗恢复。

## Impact

覆盖 Music 私有数据库、React 音乐页、工作台窗口菜单和 Windows 桌面集成。
