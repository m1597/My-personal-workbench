## ADDED Requirements

### Requirement: 文件库从磁盘核对

文件库 MUST 支持下列桌面行为。

#### Scenario: 桌面验收

- **WHEN** Windows 外部改名、移动、回收、还原或覆盖图片，或退出期间发生变更
- **THEN** 列表、搜索、缩略图与预览自动核对。删除预览项选中下一项，离线保留位置并在恢复后重新读取。
