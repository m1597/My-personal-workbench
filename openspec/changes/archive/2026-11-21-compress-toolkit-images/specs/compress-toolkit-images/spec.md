## ADDED Requirements

### Requirement: 图片体积压缩

工具集 SHALL 支持图片体积压缩。

#### Scenario: 桌面试用

- **WHEN** 选择图片及目标 KB 并导出到目录
- **THEN** 输出满足大小上限，源文件保持原样。

#### Scenario: 退出或异常

- **WHEN** 用户取消或输入无效
- **THEN** 保留原始数据，可以调整输入再操作。
