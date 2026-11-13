## ADDED Requirements

### Requirement: 全量专辑

Music SHALL 首次展示全部专辑，包括单曲专辑。

#### Scenario: 大曲库浏览

- **WHEN** 打开含至少 261 张专辑的曲库
- **THEN** 可直接浏览末尾，搜索和曲数排序覆盖全量，进入详情并返回保留位置

### Requirement: 歌单编辑及交换

Music SHALL 允许撤销刚完成的成员移除并按保存顺序导出本地路径歌单。

#### Scenario: 移除及撤销

- **WHEN** 从歌单中移除一首或多首
- **THEN** 提示数量，可撤销并恢复成员原顺序，磁盘回收另循原流程

#### Scenario: 导出

- **WHEN** 从单个歌单的上下文菜单导出
- **THEN** 写入 UTF-8 M3U8，支持中文与空格路径，其他播放器可按保存曲序读取
