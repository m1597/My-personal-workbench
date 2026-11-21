## ADDED Requirements

### Requirement: 双图对比

工具集 SHALL 支持双图对比。

#### Scenario: 桌面试用

- **WHEN** 选两张图片后切换或调整上层透明度
- **THEN** 两图位置一致，可回到单图检查。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
