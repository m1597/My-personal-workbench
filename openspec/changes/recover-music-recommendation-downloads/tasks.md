## 1. 实现

- [x] 1.1 区分检索、版本、取址、传输、保存、取消，源超时后继续换源。
- [x] 1.2 同一批并发歌曲共享目录恢复，单曲失败独立结算，按平台聚合详情。
- [x] 1.3 在本次推荐显示失败歌曲首数；由主进程选择原批次失败记录，复用下载通道，达到目标首数后结束。
- [x] 1.4 保存每条推荐匹配时的录音条件；重试复用，旧批依原请求恢复可推断条件。

## 2. 实测

- [x] 2.5 独立 Music 在榜单歌曲有同名现场版、偏好现场、请求占 100% 时，持续失败保持 4/5，恢复后仅传输原录音。读取 SQLite 核实榜单限制、指定歌手与实际版本偏好，模拟旧批无快照后再次验证。命令 `node scripts/check-recommendation-refill.mjs --retry-failed --chart`，证据 `tmp/refill-five-JwOzUM/retry.json`。

- [x] 2.1 在隔离后台 Music 复验首源超时、后备源完成、目录并发恢复和用户取消。
- [x] 2.2 独立、停靠 Music 均在来源仍失败时保持 4/5 并可再试；恢复后连续点击两次，仅重新传输《归途》，回到同一批次 5/5，原四首 item/local ID 未变，无额外模型请求。执行 `node scripts/check-recommendation-refill.mjs --retry-failed`，停靠增加 `--docked`。独立证据 `tmp/refill-five-cIRLg6/retry.json`，停靠证据 `tmp/refill-five-LrIFVq/retry.json`，各含三个状态截图。以上均以隔离目录及受控来源复验。
- [x] 2.3 用团队构建的工作台 CMD、独立安装版 0.2.4 和洛雪核对同一录音和音质，详见 docs/changes/2026-11-22-music-recommendation-recovery.md。桌面快捷方式对应构建由集成验收。
- [x] 2.4 运行 openspec validate --all --strict --no-interactive，62 项通过。

开发工作树的 Electron 独立 Music 在隐藏、不可聚焦的窗口运行，命令行静音。脚本 scripts/check-recommendation-latency.mjs 的 FITBAY_TEST_SOURCE_RECOVERY=1 模式使用隔离 profile、受控 HTTPS、真实 Worker、音频解码和落盘。证据 tmp/recommendation-latency-TrXiuX/source-recovery.json 显示传输代码 23 后第二个来源成功、单源重新取址成功、两首并发只读一次启用的备用目录，以及真实保存路径不可写的 storage/ENOENT。完整脚本的 tmp/recommendation-latency-p7ktsm 验证用户终止后文件与网络请求数不再增加。开发构建运行 node scripts/build-component-prototype.mjs。真实第三方来源、桌面 CMD 与安装包对照另由联验记录。
