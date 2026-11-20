# 自动收录目录中的新歌和歌词

## Why

用户希望 Music 持续收录所选目录，包括可能暂时离线的移动盘。

## What Changes

添加目录时可以为本次选择启用自动收录。Music 监测该目录树，重开后恢复；在外接盘离线期间保留原索引及其引用。

## Capabilities

### Modified Capabilities

- `local-music-library`：新增按目录选择的持续收录及挂载恢复。

## Impact

Music 主进程保存授权目录、增量收录和可用状态；Music 界面使用同一原生确认框并接收曲库/歌词刷新。工作台在停靠模式复用 Music；不需要公共文件监视接口。
