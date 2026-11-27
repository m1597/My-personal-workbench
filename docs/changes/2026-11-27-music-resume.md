# Music 暂停后续验收

以 `907c13e` 为基线，工作分支为 `codex/resume-1127-music`。根据锁文件执行 npm ci，重新生成工作台与组件。使用 Windows 私有桌面、隔离资料和静音 Electron。从暂停点后的歌单排序开始，本次分段运行余下 21 个专项，均退出 0。前 7 个脚本沿用上轮已通过的证据，另单独复验专辑的第二次目录导入。

## 第二次添加目录

两个目录各有四首不同录音。正常扫描 461 毫秒后显示 8 首。人为延迟扫描时，旧断言在 5.099 秒观察到 4 首，此时后台任务仍在运行。7.173 秒后扫描进程以 0 退出，新增 4、重复 0、失败 0，页面显示 8 首。两次都使用真实扫描进程，选目录对话框返回测试目录。原失败日志未记录进程退出状态，无法追溯当时的最终曲数。基线已包含按扫描完成核对曲数的提交 `628ea86`。[正常扫描](../../tmp/local-albums-03W8kR/second-import.json) · [慢扫描](../../tmp/local-albums-Mty8fI/second-import.json)

## 从设置返回

全页设置会收起主导航与播放栏。独立和停靠窗口实际从齿轮进入，单击「返回」后恢复进入时的页面。原夹具在设置打开时点击隐藏的曲库、播放和歌词控件；六个脚本已按用户实际路径操作。经比对旧组提交 `86098a8`，移植齿轮悬停与键盘焦点提示、对应测试，补充宽窄窗及返回后选中状态的断言。可挑选提交为 `b3a44b8`。[界面与各项证据](../../openspec/changes/direct-music-settings-entry/tasks.md)

## 剩余回归

以下目录来自本次开发构建，各行链接对应独立验收资料。脚本名位于 scripts 目录。

- `check-playlist-sorting.mjs` · [验收资料](../../tmp/playlist-sorting-FW6Czz)
- `check-playlist-removal-export.mjs` · [验收资料](../../tmp/playlist-removal-export-EkW9aM)
- `check-playlist-import.mjs` · [验收资料](../../tmp/music-playlist-import-s6FH8H)
- `check-music-sidebar-order.mjs` · [验收资料](../../tmp/sidebar-order-3pUYGi)
- `check-music-settings.mjs` · [验收资料](../../tmp/music-settings-5r3MXG)
- `check-music-keyboard.mjs` · [验收资料](../../tmp/music-keyboard-Rc3MRF)
- `check-music-queue.mjs` · [验收资料](../../tmp/music-queue-4e0nRd)
- `check-timed-playlist.mjs` · [验收资料](../../tmp/timed-playlist-lQXHuU)
- `check-music-presentation.mjs` · [验收资料](../../tmp/music-presentation-b7Rf4f)
- `check-music-infrequent.mjs` · [验收资料](../../tmp/music-infrequent-L8Q1Sy)
- `check-music-lyrics.mjs` · [验收资料](../../tmp/music-lyrics-Llsaq2)
- `check-wrapped-lyrics.mjs` · [验收资料](../../tmp/wrapped-lyrics-lrAITj)
- `check-online-playlist.mjs` · [验收资料](../../tmp/online-playlist-reUWg3)
- `check-playlist-download-all.mjs` · [验收资料](../../tmp/playlist-download-all-ETD0dz)
- `check-listening-clips.mjs` · [验收资料](../../tmp/listening-clips-AO418h)
- `check-music-release-catalog.mjs` · [验收资料](../../tmp/music-release-catalog-TVu1XZ)
- `check-music-download-tasks.mjs` · [验收资料](../../tmp/music-task-panel-RifHot)
- `check-music-feed-lyrics.mjs` · [验收资料](../../tmp/feed-lyrics-ui-4aBSBi)
- `check-discovery-layout.mjs` · [验收资料](../../tmp/discovery-layout-zTCgmW)
- `check-player-options.mjs` · [验收资料](../../tmp/music-player-options-SnuCB5)
- `check-download-lrc.mjs` · [验收资料](../../tmp/music-download-lrc-nrNthp)

## 适用范围

推荐换源和安装升级沿用[既有实网与安装验收](2026-11-22-music-recommendation-recovery.md)。本轮未重新安装、覆盖升级、拔插实际硬件或执行听感测试。构建、桌面入口 --check、OpenSpec 全库严格校验（62 项）、lint、类型检查和两项 doctor 单测通过。全仓 npm run check 停在基线已有的六份历史验收 Markdown 表格格式。日志见 [格式检查](../../tmp/resume-format-final.log)。
工作台交互在私有桌面分开执行。生产构建 17 passed (47.7s)，开发构建 17 passed (1.3m)。[生产日志](../../tmp/resume-workbench-interaction.log) · [开发日志](../../tmp/resume-workbench-dev-interaction.log)
