## ADDED Requirements

### Requirement: 组件释放资源一次

文件库 MUST 支持下列桌面行为。

#### Scenario: 桌面验收

- **WHEN** 打开连接后关闭组件、重开或随宿主退出
- **THEN** 组件可重开，宿主正常退出，无 database is not open 或残留监听器。
