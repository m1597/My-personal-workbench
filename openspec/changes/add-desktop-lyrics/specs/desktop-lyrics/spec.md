## ADDED Requirements

### Requirement: 下载关联同步歌词

永久保存录音时，系统 SHALL 优先使用同名本地歌词，尝试为缺少歌词的录音按版本获取 LRC。

#### Scenario: 下载源没有同步歌词

- **WHEN** 已成功保存音频但缺少歌词或歌词请求失败
- **THEN** 音频照常入库

### Requirement: 桌面歌词

系统 SHALL 提供默认关闭、可拖动与锁定的独立透明置顶歌词窗口。

#### Scenario: 在暂停时跳转

- **WHEN** 用户开启“词”后暂停并调整进度
- **THEN** 窗口显示该时间点的歌词

### Requirement: 配套歌词回收

系统 SHALL 仅将本次回收音频对应的、由 FitBay 创建且仍未修改的歌词列入回收确认。

#### Scenario: 用户编辑歌词

- **WHEN** 音频对应的 LRC 已被改写
- **THEN** 回收音频时保留歌词
