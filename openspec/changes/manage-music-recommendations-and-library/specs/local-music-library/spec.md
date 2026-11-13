## ADDED Requirements

### Requirement: 曲库目录排序与回收一致性

Music SHALL 支持曲库目录排序与回收一致性。

#### Scenario: 实际使用

- **WHEN** 用户执行相应的 Music 操作
- **THEN** 文件夹、歌单分别拖动排序，显示插入位置并持久保存。回收成功后刷新计数和引用，重开仍一致；失败反馈实际结果。
