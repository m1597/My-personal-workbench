# Music 桌面开发构建交接 · 2026-11-22

桌面 FitBay.cmd 调用本仓库的 scripts/open-workbench.cmd --workbench。停靠从「组件 → Music」进入，独立形态使用同一 dist/component-prototype/host 的 Music 模式。复测使用临时 profile、后台窗口及静音音频，保留日常曲库和设置。

## 设置分类

提交 41a91ee。在两个入口进入音乐设置，单击「下载」，再单击内容标题。仅侧栏标出当前分类。按 Tab 后，具体控件出现键盘焦点。另测总览搜索直达歌词与快捷键。[两种窗口截图](../../tmp/music-category-focus-bncpVe/comparison.jpg)

## 快捷键

提交 792aab5、61878a9。两种入口都在「音乐设置 → 快捷键」录入 F8 和 Ctrl+Shift+F9，分别试同组件重复分配与系统已占用的按键。失败后原绑定继续有效。Esc 取消，单项恢复保留另一项的自定义值，全部恢复后重启，应用内关、全局开、媒体键关均保留。另测搜索时方向键选行与追加队列。[双入口重启证据](../../tmp/music-shortcut-reset-S4CD7x) · [搜索焦点回归](../../tmp/music-keyboard-Nzh5wG)

## 歌曲行

提交 c3cc5f5。用隔离曲库各打开自建歌单、收藏、找歌结果及歌手页。单击曲名保持暂停，按下至随后五帧底色一致且选中标记可见；双击后音频时间前进。歌手、专辑按钮分别进入详情。歌单和收藏可同时勾选两首。[各入口步骤及证据](2026-11-22-music-song-rows.md)

## 构建与检查

npm run build:prototype 和 scripts/open-workbench.cmd --check 成功。实测 Music JS 的 SHA-256 为 A8A25A423FE6EE6FE3B5C090F35DF19EB2EB82D58FD70C14966200A9CF2E9096，CSS 为 BAD07E1C8BA7D5699319FEFE91A0803CDD0E8CC45F5D8593C1C0E53414106868。[构建日志](../../tmp/music-nov22-desktop-build.log) · [构建后设置与快捷键](../../tmp/FitBaySuite_check_996271fc411242758420b0326c49668a.log)

OpenSpec 严格校验通过 64 项。工作台生产模式通过 16 项，开发模式首次通过 14 项，两项单独重跑通过。全仓 npm run check 在格式检查停止；独立运行 lint 也报告共享工作区其他组件的问题。[工程检查](../../tmp/FitBaySuite_check_c6a91072232240f08cc34a2483b18573.log) · [开发模式重跑](../../tmp/FitBaySuite_check_2ddc37ee4a834265835ac7d1665ad0e7.log)

集成验收可按上述提交与构建摘要核对候选。硬件显示合成、用户前台操作、发行安装包和远程 CI 未验。
