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

## 3. 同版换源与坏源恢复

- [x] 3.1 实现选定录音与音质的锁定、分脚本和平台的可恢复暂停，沿用内置开源目录与已启用的网站清单。设置页可查看原因并重新选择恢复。
- [x] 3.2 从后台静音独立 Music 验证。隔离副本中源返回坏地址，四首各自使用第二源以 320k 入库，失败记录依次 1、2、3、3；主进程仅实际调用坏源三次。在设置 → 音乐源查看原因，重新选择后记录回到零。已锁定录音遇到另一张专辑或将 32 kbps CBR 冒充 320k 时，跳过并使用下一来源。传输超时、实际本地 ENOENT 不增加坏源证据，两首共同刷新并从授权清单发现新源一次。命令为设置 FITBAY_TEST_SOURCE_RECOVERY=1 后执行 node scripts/check-recommendation-latency.mjs；证据 tmp/recommendation-latency-0bnhUG/source-recovery.json。
- [x] 3.3 新建隔离 profile 实际访问项目目录并发现 12 个来源。仅从该隔离库复制来源到另一个隔离 profile，从找歌 → AI 推荐请求《Here [cover JUNNA]》，验证新发现的 Hello World 源实际完成网易云录音 2697554394：MP3 为 10,536,045 字节，读取编码为 MPEG-1 Layer III CBR 320000 bps，配套 LRC 为 1731 字节；从原歌单静音播放至 0.876 秒。脚本 scripts/check-cmd-recommendation-live.mjs 支持 FITBAY_TEST_DEV_HOST 指定开发载荷。证据 tmp/desktop-check-27-1357844429/download-play.json。公开网站清单恢复用受控 HTTPS 传输，实时第三方网站清单未实测。测试库重开后仍暂停，其他平台和更新脚本可用；将测试库时间戳移早 25 小时后恢复，见 tmp/source-health-clock-dpyEVT/receipt.json。本轮未覆盖用户安装版本。
- [x] 3.4 openspec validate --all --strict --no-interactive 通过；本事项文件 Biome 格式及 lint 检查通过。
