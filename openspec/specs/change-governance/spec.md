# change-governance Specification

## Purpose

为个人工作台的维护者及协作助手规定重要变更的记录、验证和归档方式，使后来接手者能从仓库定位现行行为、当时提出的修改及其验收依据。

## Requirements

### Requirement: 重要变更采用标准记录

维护者 MUST 使用项目配置的 spec-driven 工作流记录重要变更。

#### Scenario: 开始跨模块协议修改

- **WHEN** 维护者开始修改跨模块协议
- **THEN** 在变更目录记录提案、设计、能力差异及实施任务，并在涉及架构选择时关联 ADR。

### Requirement: 已完成的变更归档

维护者 MUST 在验收完成且严格校验通过后使用 CLI 归档变更。

#### Scenario: 完成含能力变更的任务

- **WHEN** 实施任务已完成且严格校验通过
- **THEN** 归档操作将能力差异合入现行规范，并保留已完成变更文件。

#### Scenario: 验收尚未完成

- **WHEN** 仍有未通过的必需验收项
- **THEN** 变更保持活动状态，在任务记录中标明待办。
