## ADDED Requirements

### Requirement: Music 设置分类可从工作台定位

Music SHALL 发布与实际设置分类一致的名称、路径和目标，并处理宿主设置定位请求。

#### Scenario: 从工作台搜索歌词或快捷键

- **WHEN** 工作台根据 Music 清单选择“歌词”或“快捷键”并发送对应目标
- **THEN** Music 打开音乐设置，选中目标分类，展示该分类的实际控件

#### Scenario: 老版本或未知目标

- **WHEN** 收到没有目标或目标未知的新设置请求
- **THEN** Music 打开设置，保留当前分类；后续合法目标仍可直达

#### Scenario: 重复快照

- **WHEN** 同一设置请求编号重复到达
- **THEN** 不覆盖用户随后选择的分类
