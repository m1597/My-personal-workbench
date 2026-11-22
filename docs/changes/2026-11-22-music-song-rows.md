# 歌曲行点击与多选复验 · 2026-11-22

桌面 FitBay.cmd 指向本仓库。使用其 dist/component-prototype/host 和 out/renderer/index.html，独立 Music 与工作台「组件 → Music」均使用临时 profile、静音和后台窗口。组件 CSS SHA-256 为 BAD07E1C8BA7D5699319FEFE91A0803CDD0E8CC45F5D8593C1C0E53414106868。

| 入口               | 操作与预期                                                                             | 实际                                                   |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 全部歌曲           | 单击保持悬停底色、左边标记选中、播放器暂停，双击播放；920 和 410 宽检查布局            | 独立窗口通过，见 tmp/library-row-layout-nkWfM9         |
| 自建歌单、我的收藏 | 单击曲名，按下到随后五帧背景保持一致，左边选中标记出现；双击播放本地音频；多选勾选两条 | 独立和停靠均通过；每个复选框均可见且已选中             |
| 歌手详情、专辑详情 | 单击收藏歌曲的歌手和专辑，进入对应主页；歌手页单击已收录曲名选中，双击播放             | 两种形态均通过，歌手页没有多选入口                     |
| 找歌搜索结果       | 受控测试音源搜索「远山 青禾」，单击检查同样六次背景采样、左标记和暂停，双击播放        | 两种形态均通过；找歌结果没有多选入口；使用隔离网络响应 |

运行 node scripts/check-library-row-layout.mjs、node scripts/check-song-row-surfaces.mjs、node scripts/check-music-online-search.mjs，以及后者加 --docked。歌单、收藏、歌手选中截图在 tmp/song-row-surfaces-5kSh5n，找歌截图分别在 tmp/music-online-search-XhGXfS 和 tmp/music-online-search-K764p7。用实际 Chromium 输入事件和 audio 播放时间检查。后台截图保留透明通道。物理显卡合成画面、真实第三方音源和发行安装包未在本项验证。
