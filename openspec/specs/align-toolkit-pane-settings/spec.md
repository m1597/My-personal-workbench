# align-toolkit-pane-settings Specification

## Purpose

规定独立和停靠入口中用户能观察并复测的行为，兼顾取消后的恢复与本地数据的完整性。工具集 SHALL 使用公共设置壳并保留原工具输入。

## Requirements

### Requirement: 工具集窗格设置

工具集 SHALL 使用公共设置壳并保留原工具输入。

#### Scenario: 实际桌面入口

- **WHEN** 在逐行对比输入文本再进入设置和返回
- **THEN** 原文本、文件选择与活动工具保留，窄窗可进入各设置分类。
