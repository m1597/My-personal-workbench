## ADDED Requirements

### Requirement: 逐行文本对比

工具集 SHALL 支持逐行文本对比。

#### Scenario: 桌面试用

- **WHEN** 输入两段文字进行比较
- **THEN** 相同、删除和新增行显示行号，插入单行不影响后续匹配。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
