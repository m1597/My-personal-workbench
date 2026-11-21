# measure-toolkit-screen Specification

## Purpose

规定工具集在独立窗口和工作台停靠入口的屏幕测距与取色操作、结果及恢复行为。从工具列表进入屏幕测量，在屏幕指定两点并取色，显示物理像素距离与十六进制颜色，Esc 取消。

## Requirements

### Requirement: 屏幕测距与取色

工具集 SHALL 支持屏幕测距与取色。

#### Scenario: 桌面试用

- **WHEN** 从工具列表进入屏幕测量，在屏幕指定两点并取色
- **THEN** 显示物理像素距离与十六进制颜色，Esc 取消。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
