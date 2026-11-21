## ADDED Requirements

### Requirement: 截图标注

工具集 SHALL 支持截图标注。

#### Scenario: 桌面试用

- **WHEN** 框选后选择标注并绘制，应用到当前选区
- **THEN** 撤销可恢复原像素，复制、保存、贴图使用已应用标注。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
