## ADDED Requirements

### Requirement: 粘贴与拖入提示词

提示词库 SHALL 在明确选择的目录内导入 TXT/MD，保留 UTF-8 原文和同名已有文件，按设置决定是否自动生成可视化。

#### Scenario: 从独立或停靠入口使用

- **WHEN** 用户在提示词库导入或选择条目并调用本功能
- **THEN** SKILL.md 作为 Markdown 收录，绝不执行，外部删除后卡片消失。
