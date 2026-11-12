## ADDED Requirements

### Requirement: 分类管理音乐设置

设置 SHALL 在右侧只呈现当前分类，普通窗口展示侧栏，窄窗口可展开分类菜单。

#### Scenario: 切换分类

- **WHEN** 用户进入音乐源、下载或快捷键等分类
- **THEN** 只显示对应设置，公共播放器持续可用

### Requirement: 音乐源专用本地工具

系统 SHALL 允许本机 MCP 客户端列出来源、按目录 ID 导入、检查能力及切换来源。

#### Scenario: 本地 Agent 使用来源

- **WHEN** 已连接 Music 的本机客户端请求已定义的音源操作
- **THEN** 通过同一业务逻辑处理且限制操作参数；禁止通用文件、命令和脚本执行
