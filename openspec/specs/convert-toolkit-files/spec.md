# convert-toolkit-files Specification

## Purpose

规定工具集在独立窗口和工作台停靠入口的本地批量格式转换操作、结果及恢复行为。选择图片或 DOCX 并选定导出目录，本地 WebP 转 PNG、Word 或 LibreOffice 将 DOCX 转 PDF，逐项显示结果且保留原件。

## Requirements

### Requirement: 本地批量格式转换

工具集 SHALL 支持本地批量格式转换。

#### Scenario: 桌面试用

- **WHEN** 选择图片或 DOCX 并选定导出目录
- **THEN** 本地 WebP 转 PNG、Word 或 LibreOffice 将 DOCX 转 PDF，逐项显示结果且保留原件。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
