## Why

用户需要一次整理多首歌，并希望推荐首数代表真正能在本地播放的新录音。

## What Changes

- 在本地曲库及歌单按当前列表多选并管理歌单成员。
- 每日推荐按指定首数补推，只展示成功下载入库的歌曲，可取消并检查批次诊断。
- 移除推荐模式切换。用户可填写自然语言描述或留空使用已有偏好；泛风格优先不同艺人。模型配置提供四种在线服务商。

## Capabilities

### Modified Capabilities

- `local-music-library`
- `music-pages`
- `model-recommendation`

## Impact

涉及 Music 界面、私有 SQLite、在线模型与目录查询。
