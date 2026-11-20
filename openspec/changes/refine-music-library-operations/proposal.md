# Proposal

## Why

原 Music 合并变更包含多个可独立验收的目标，完成状态和当前要求不易追踪。本变更集中收敛「本地曲库浏览与文件操作」，承接已有实现及历史证据，不重新授权新功能。

## What Changes

整理本地搜索、排序、拖出、目录批量操作及按时长播放；不引入模型或修改在线目录。

历史来源、任务映射和替代规则见[拆分索引](../../../docs/changes/2026-11-20-openspec-reorganization.md)。

## Capabilities

### New Capabilities

无。沿用现有能力目录。

### Modified Capabilities

- `local-music-library`：本地曲库浏览与文件操作涉及的行为。

## Impact

仅本变更范围内的 Music 入口和对应规范；拆分不修改代码、运行数据或已归档记录。与其他变更按能力和需求标题划分所有权，归档前核对依赖及实测证据。

本轮追加已确认的多文件、多目录导入，复用「全部歌曲」和本地曲库设置入口。目录持续收录独立交付，见 watch-music-library-folders。
