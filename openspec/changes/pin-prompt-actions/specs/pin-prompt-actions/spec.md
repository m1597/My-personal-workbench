## ADDED Requirements

### Requirement: 固定提示词为工具集动作

仓库 MUST 为固定文件生成持久 ID，并在每次执行时读取当前文件。

#### Scenario: 桌面入口

- **WHEN** 用户从提示词仓库执行该操作
- **THEN** 修改「解释推导」后再次截图使用新模板；删除文件返回 FILE_UNAVAILABLE。
