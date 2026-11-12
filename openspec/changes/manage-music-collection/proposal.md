## Why

用户需要在本地曲库整理已有录音，在一个设置页配置导入和播放方式，并将新推荐直接保存为可播放的本地歌曲。各操作需要说明对原件、歌单引用和偏好授权的影响。

## What Changes

增加设置页、文件和歌单管理、可单字段搜索、按授权增量更新的审美文档及自动保存推荐录音。

## Capabilities

- music-pages、music-preferences、lx-download、local-music-library：更新音乐组件和来源的操作规则。
- music-settings：集中配置并注册组件生命周期内的全局媒体快捷键。

## Impact

组件私有 SQLite、媒体源、Electron 文件与快捷键服务、Music 四页界面及自动验收。
