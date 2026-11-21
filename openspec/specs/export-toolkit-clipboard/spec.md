# export-toolkit-clipboard Specification

## Purpose

规定工具集在独立窗口和工作台停靠入口的剪贴板处理操作、结果及恢复行为。主动读取剪贴板，按内容复制纯文本、导出 Markdown 或提示词、导出 PNG，空数据提示重新复制，已有文件不会被无声覆盖。

## Requirements

### Requirement: 剪贴板处理

工具集 SHALL 支持剪贴板处理。

#### Scenario: 桌面试用

- **WHEN** 主动读取剪贴板，按内容复制纯文本、导出 Markdown 或提示词、导出 PNG
- **THEN** 空数据提示重新复制，已有文件不会被无声覆盖。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
