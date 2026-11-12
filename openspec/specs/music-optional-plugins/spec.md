# music-optional-plugins Specification

## Purpose

说明 Music 第一方插件的独立安装与移除，以及首次使用时发现音源、模型推荐和插件功能的路径。

## Requirements

### Requirement: 可选插件

Music SHALL 在用户安装经当前版本校验的独立包后启用对应工具，在设置中显示用途、大小及操作。

#### Scenario: 安装和卸载

- **WHEN** 用户安装一个插件、卸载后再安装
- **THEN** 只有已装插件可打开，已有标记和歌单规则可继续使用

#### Scenario: 使用三种工具

- **WHEN** 用户分别打开对应插件
- **THEN** 波形可定位、选区循环及添加标记，标签封面仅写入勾选字段和文件，智能歌单按来源、时间和有效播放次数动态更新

### Requirement: 首次引导

Music SHALL 显示可跳过的音源 MCP、模型 API 和插件卡片，提供实际入口并支持在设置中重新查看。

#### Scenario: 重启与重看

- **WHEN** 已展示过引导的用户重启 Music
- **THEN** 常规启动进入曲库，用户可主动重放引导并跳至对应功能
