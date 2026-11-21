## ADDED Requirements

### Requirement: 工具集入口与图标

工具集 SHALL 支持工具集入口与图标。

#### Scenario: 桌面试用

- **WHEN** 独立首页与宿主列出截图、划词及工具，齿轮进入设置
- **THEN** 320 像素窄窗可操作，工具箱图标覆盖窗口、任务栏、快捷方式和标签。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
