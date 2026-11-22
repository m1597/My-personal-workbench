## Why

Music 将 TimeoutError 的数值代码认作存储错误，提前退出换源、取消同批其他歌曲。现行 lx-download 已要求推荐无响应时换源。手动歌单下载有独立 change 和队列，推荐失败恢复从找歌页面单独验收。

## What Changes

按失败阶段处理单源超时、单曲失败、目录恢复与推荐结果重试。按平台合并同类原因。

## Capabilities

- lx-download 规定换源、目录恢复与已完成文件处理。
- music-pages 规定原批次失败项入口及反馈。

## Impact

Music 宿主负责来源、下载和诊断；Music 页面负责原批次重试和播放。平台及打包组联验桌面开发入口、安装构建。
