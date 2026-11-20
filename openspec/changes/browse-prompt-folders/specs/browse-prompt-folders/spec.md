## ADDED Requirements

### Requirement: 本地提示词目录与编辑

组件 MUST 区分当前和默认目录，显示文件树及预览，保存前检查外部修改。

#### Scenario: 桌面入口

- **WHEN** 用户从提示词仓库执行该操作
- **THEN** 临时打开 B 后重启回到默认 A；外部修改自动刷新，未保存草稿保留并可重新加载。
