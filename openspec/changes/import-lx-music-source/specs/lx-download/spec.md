## ADDED Requirements

### Requirement: 独立使用音乐源

FitBay SHALL 在未安装洛雪的环境中使用用户导入的兼容源，从本地歌曲搜索并保存所选版本。

#### Scenario: 用户选择版本和目录

- **WHEN** 用户从曲库查找版本并在系统对话框选择目录
- **THEN** FitBay 保存经验证的音频并将其加入曲库，保留已有文件。
#### Scenario: 源请求失败

- **WHEN** 源不可用或返回非音频内容
- **THEN** 界面反馈失败并避免发布无效文件。
