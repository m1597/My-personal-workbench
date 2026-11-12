## ADDED Requirements

### Requirement: 真实组件工作区

工作台 SHALL 从空工作区提供 Music 入口，恢复时只清除退役或不可用的引用。

#### Scenario: 混合旧布局

- **WHEN** 旧布局包含 Music、其他有效组件和退役占位标签
- **THEN** 恢复有效分组和活动标签，收拢空组并将旧音乐标题更新为 Music

#### Scenario: 首次启动或空布局

- **WHEN** 首次启动、只保存了占位窗口或已经关闭所有组件
- **THEN** 展示空工作区，仍可打开 Music 并停靠或分离
