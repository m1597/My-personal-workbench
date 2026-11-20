# consume-prompt-actions Specification

## Purpose

在截图或划词面板列出仓库已注册且接受当前输入的动作，执行后在同一面板呈现结果。保留内置操作，仓库恢复后重新读取动作清单。

## Requirements

### Requirement: 提示词动作消费

工具集 SHALL 支持提示词动作消费。

#### Scenario: 从桌面入口使用

- **WHEN** 用户发起提示词动作消费
- **THEN** 在截图或划词面板列出仓库已注册且接受当前输入的动作，执行后在同一面板呈现结果。

#### Scenario: 仓库缺席

- **WHEN** 仓库缺席
- **THEN** 保留内置操作，仓库恢复后重新读取动作清单。
