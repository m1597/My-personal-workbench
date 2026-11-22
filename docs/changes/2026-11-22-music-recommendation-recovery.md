# Music 推荐下载与播放复验

## 五首推荐与恢复

独立和停靠 Music 各生成一批五首。在受控音源持续返回故障时，四首可以立即播放。恢复服务后连续单击两次「仅重试失败歌曲」，同一批变成五首，仅传输第五首，原四首的曲目 ID 与本地 ID 保持一致，模型请求数保持不变。见本工作树 tmp/refill-five-cIRLg6/retry.json 和 tmp/refill-five-LrIFVq/retry.json。

首源传输超时（DOMException，code 23）后，下一来源完成同一录音；两首同时需要重新读取已配置的音源目录时只读取一次。真实保存路径故障单独显示 ENOENT。见 tmp/recommendation-latency-sEGjT1/source-recovery.json。此次受控故障测试用于复现错误分类和恢复，不能用作公网耗时比较。

## 当前音源的桌面实测

在私有 Windows 桌面使用隔离资料，复制已启用音源的定义。测试模型只在本机回环响应，推荐指定录音；搜索、地址解析、音频传输及播放使用真实服务。通过组件工作树的 scripts/open-workbench.cmd --verify-desktop 启动工作台，从「组件 → Music → 找歌 → AI 推荐」生成，再从「歌单 → 歌曲推荐 → 播放全部」启动本地播放器。

- 工作台 CMD 和已安装的独立 Music 0.2.4 都从 fish_music 下载了綾下蒔間Ayaka《Here [cover JUNNA]》。平台为网易云，录音 ID 为 2697554394，音质为 320k。两个文件均为 10,536,045 字节。静音播放时，工作台记录到 0.863 秒，安装版记录到 0.853 秒。证据在 tmp/desktop-check-14551-6311/download-play.json 与 tmp/desktop-check-0-1928046482/download-play.json。
- 用独立资料启动洛雪桌面版，使用同一音源、平台及音质。缓存录音标识为 wy_2697554394_320k。洛雪在 3.984 秒进入播放，媒体时长 263.33 秒。见 tmp/lx-compare-LVcoTF/evidence.json。此次对照核对录音、来源及可播性，两边计时时点不同。
- 实网首个样本《Monkeys Spinning Monkeys》未取得许可明确的永久保存结果。该结果与上述成功下载分开记录，见 tmp/desktop-check-12909-6583。
- 复测脚本为 scripts/check-cmd-recommendation-live.mjs。传入本工作树 tmp 下新建的 CMD 验收 profile 和已配置音源的曲库 SQLite 路径。独立安装版可通过 FITBAY_TEST_MUSIC_EXE 指定绝对路径。脚本不输出密钥、脚本内容或播放地址。

## 原有播放与界面验收

歌曲行、设置分类、快捷键独立和停靠复验见 [Music 桌面交接](2026-11-22-music-desktop-handoff.md)。多目录选择、断线补扫、整单导入、跳过已有下载、收藏自动归类及歌词跟随、倍速时钟、随机切歌和重启队列见 [项目任务记录](../任务记录.md)。本次复用了对应功能的已有验收。物理 USB 拔插未实测。

## 构建范围

除团队 CMD 外，另从桌面 FitBay.cmd 指向的 workbench/scripts/open-workbench.cmd 用 --verify-desktop 启动当前实际构建，从推荐到下载、入库及歌单播放通过，时钟为 0.843 秒。证据为 workbench/tmp/desktop-check-16223-4471/download-play.json。该入口使用隔离资料；新的错误分流和失败项重试在 team/music 及集成候选验收。候选 9c43730 的 Windows 统一检查 45011485936 已通过。安装版覆盖要求同一 Windows 账户与同一隔离 profile 跨版本验证。脚本、阶段和结果在 [安装升级验收](../../openspec/changes/recover-installed-music-profile/tasks.md)。
