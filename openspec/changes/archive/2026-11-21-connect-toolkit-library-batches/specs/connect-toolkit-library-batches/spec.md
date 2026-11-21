## ADDED Requirements

### Requirement: 文件库批处理

工具集 SHALL 从受信文件库交接读取当前批次并提供改名预览或尺寸副本。

#### Scenario: 实际桌面入口

- **WHEN** 选择两张图后发送改尺寸或改名
- **THEN** 改尺寸产生指定宽高的新图；改名在确认后执行，冲突不覆盖。
