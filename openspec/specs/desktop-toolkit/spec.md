# desktop-toolkit Specification

## Purpose

从独立安装入口或工作台组件菜单打开工具集，分别启停两项工具和修改快捷键。注册新键失败时保留旧绑定，显示冲突；关闭工具后释放绑定。

## Requirements

### Requirement: 工具集入口

工具集 SHALL 支持工具集入口。

#### Scenario: 从桌面入口使用

- **WHEN** 用户发起工具集入口
- **THEN** 从独立安装入口或工作台组件菜单打开工具集，分别启停两项工具和修改快捷键。

#### Scenario: 快捷键冲突

- **WHEN** 快捷键冲突
- **THEN** 注册新键失败时保留旧绑定，显示冲突；关闭工具后释放绑定。
