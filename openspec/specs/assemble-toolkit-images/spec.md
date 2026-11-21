# assemble-toolkit-images Specification

## Purpose

规定工具集在独立窗口和工作台停靠入口的图片排序与导出操作、结果及恢复行为。选择多张图片，调整顺序，导出长图或 PDF，长图顺序与列表一致，PDF 每张一页。

## Requirements

### Requirement: 图片排序与导出

工具集 SHALL 支持图片排序与导出。

#### Scenario: 桌面试用

- **WHEN** 选择多张图片，调整顺序，导出长图或 PDF
- **THEN** 长图顺序与列表一致，PDF 每张一页。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
