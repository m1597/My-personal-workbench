# Design

## Context

见 proposal.md 的范围及拆分索引。现有实现已部分验证；历史勾选不等于当前工作区全部通过，本次整理只重建文档边界。

## Goals / Non-Goals

目标：让本功能可独立追踪、复验和归档。非目标：重做已通过行为、增加未确认功能、修改其他组实现。

## Decisions

文件操作按索引 ID 由主进程校验，默认仅移除引用，回收另行确认。列表选择与播放分离，文件手柄拖出与歌单排序使用不同目标。按时长选曲先预览后替换队列。

保留原任务编号的映射；采用独立变更而非继续追加至综合清单，使外屏等硬件待验不阻塞无关功能归档。

## Risks / Trade-offs

- 历史报告可能对应旧代码 → 对照当前专项记录和真实入口；有证据且未受影响的项目不重复实现。
- 多个变更涉及同一能力目录 → 按需求标题分工，归档前先读取最新主规范；不得覆盖其他变更的场景。
- 硬件或在线服务不可用 → 明确保留待验，不将模拟结果写成真实设备通过。

## Migration Plan

原合并文档转入 docs/changes/superseded-*，完整保留以供追溯。只在核实当前实现和验收证据后同步本变更差异，再使用 CLI 归档；不迁移用户数据。

Windows 原生文件选择器分别请求文件或目录及多选标志。导入 worker 按规范化路径去重目录遍历，单个选项访问失败不终止其余条目。Music 宿主保存用户选择，工作台复用 Music 入口。原生多选依据 Electron 的 Windows IFileOpenDialog 实现。[Electron file_dialog_win.cc](https://github.com/electron/electron/blob/main/shell/browser/ui/file_dialog_win.cc)
