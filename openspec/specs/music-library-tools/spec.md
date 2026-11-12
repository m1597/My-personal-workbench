# music-library-tools Specification

## Purpose

规范 Music 本地曲库的有效播放历史、资料备份恢复和换盘定位，维持曲目与歌单记录之间的引用。

## Requirements

### Requirement: 按有效播放回看历史

Music SHALL 用既有有效收听口径记录事件，并按本地日期分组。

#### Scenario: 回听

- **WHEN** 一次收听累计 30 秒或短歌完整播放
- **THEN** 历史按今天、昨天和更早展示，点击记录可重听

### Requirement: 备份与恢复

Music SHALL 导出曲库资料，在确认恢复前预览歌单和歌曲数量，提示另行备份音频。

#### Scenario: 恢复资料

- **WHEN** 用户确认导入有效备份
- **THEN** 恢复歌单顺序、收藏、有效播放记录和推荐偏好

### Requirement: 换盘找回

Music SHALL 保留曲目身份，预览并批量确认新路径，对歧义允许手选。

#### Scenario: 外接盘移动

- **WHEN** 用户授权选择新目录并确认匹配
- **THEN** 已匹配曲目可播放并保持歌单和历史引用，未找到的记录保留
