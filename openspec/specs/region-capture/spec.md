# region-capture Specification

## Purpose

在光标所在显示器框选，以原始像素复制、保存 PNG 或生成可关闭的置顶贴图。Escape 取消；空选区可重新框选，整个流程无模型请求。

## Requirements

### Requirement: 本地框选截图

工具集 SHALL 支持本地框选截图。

#### Scenario: 从桌面入口使用

- **WHEN** 用户发起本地框选截图
- **THEN** 在光标所在显示器框选，以原始像素复制、保存 PNG 或生成可关闭的置顶贴图。

#### Scenario: 取消或空选区

- **WHEN** 取消或空选区
- **THEN** Escape 取消；空选区可重新框选，整个流程无模型请求。
