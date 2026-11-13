## ADDED Requirements

### Requirement: 离线全页播放视图

Music SHALL 从播放栏歌名提供简约播放页。

#### Scenario: 换曲与跳转

- **WHEN** 用户打开播放页、切歌或拖动进度
- **THEN** 左侧呈现当前本地封面或打包的蓝色玻璃默认图，右侧高亮当前行并随进度平滑滚动；无歌词显示「暂无歌词」

### Requirement: 下一首播放整张专辑

Music SHALL 允许从专辑右键菜单将整张专辑插入当前曲之后。

#### Scenario: 在歌曲播放中插入专辑

- **WHEN** 选择「下一首播放整张」
- **THEN** 当前音频继续，随后按所选专辑碟号、轨号播放可用曲目
