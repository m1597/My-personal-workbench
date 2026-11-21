## ADDED Requirements

### Requirement: 配对重命名

工具集 SHALL 支持配对重命名。

#### Scenario: 桌面试用

- **WHEN** 选择同名或手动配对的图片和提示词，输入前缀预览并确认
- **THEN** 检查重名、缺配对和已有文件，冲突可更改后重试。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
