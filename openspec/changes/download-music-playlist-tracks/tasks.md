## 1. 实现

- [x] 1.1 三类歌单的「播放全部」右侧加入下载按钮、提示、数量反馈与失败项重试。
- [x] 1.2 在 Music 宿主预留并串行处理录音，复用目录、音质、歌词和任务面板。
- [x] 1.3 缺失的已下载文件恢复原记录，保留收藏和成员次序，播放优先使用本地副本。

## 2. 实测

- [x] 2.1 在 Windows 私有桌面的静音 Electron 隔离 profile 中，从自建混合歌单连续点击两次，验证首次入队 2、跳过 2，第二次入队 0、跳过 4。实际悬停可读「下载全部」。
- [x] 2.2 音频夹具返回 HTTP 503 后仅失败录音重试，成功文件和原歌曲顺序保留；下载目录出现同名歌词。
- [x] 2.3 删除收藏中的已下载文件，在收藏页重新下载，核对原本地 ID 与收藏关系；同一歌单在音频网络返回 503 时播放，音频时钟前进、在线读取次数为零。
- [x] 2.4 实际导入单曲 M3U8，点击下载全部，入队 0、跳过 1。
- [x] 2.5 回归原有手动下载面板和混选下载。证据见 `scripts/check-playlist-download-all.mjs`、`scripts/check-online-playlist.mjs` 和 `scripts/check-music-download-tasks.mjs`。测试使用可重复的 HTTPS 响应夹具和实际落盘音频；物理断开整机网络及第三方线上源未验证。
- [x] 2.6 已执行 `openspec validate --all --strict --no-interactive`，本次验证 32 项全部通过。截图位于本地 `tmp/playlist-download-all-XirUvd/partial-failure.png` 和 `offline.png`。
