# Music 轻量功能候选

以下四项供选题讨论，尚待确认。优先建议选「点歌词跳转」和「播放栏收藏」：它们分别利用已有歌词时间戳和曲库收藏，只需给用户一个更直接的入口。

## 点歌词跳到那一句

想重听一段时，在播放页直接点该句，比拖进度条找位置更准。现有播放页已按时间戳渲染歌词、标出当前行，进度条也能定位音频。建议让带时间戳的行支持鼠标和键盘激活，并保留播放或暂停状态。验收时可分别在播放中和暂停时选择第二段，检查声音位置和歌词高亮。参考 Apple Music 的逐行跳转交互。[FitBay 播放页](../components/music/NowPlaying.tsx) · [Apple Music 歌词指南](https://support.apple.com/en-tj/guide/music/musf438ffc97/1.6/mac/26)

## 在播放栏收藏当前歌曲

听每日推荐时，用户可直接在歌名旁点一下，将已入库歌曲加入「我的收藏」，再点一次取消。曲库已有收藏状态和写入接口，播放栏可共用它们。验收时在仅播放栏视图收藏，展开曲库查看结果，再切歌核对按钮是否跟随新曲目。参考 Apple Music 在 Windows 播放控件上提供的收藏入口。[FitBay 曲库收藏](../components/music/LibraryPane.tsx) · [Apple Music 收藏指南](https://support.apple.com/en-ca/guide/music-windows/musa407e11b8/windows)

## 播完这首就停

准备结束试听时，在播放队列里勾选「播完这首就停」。MPD 提供一次性的单曲模式；FitBay 可借用一次生效的设计，把标记绑定到当前曲目。建议自然结束时优先停播并清除标记，保留后续队列；用户手动切歌时也清除。现有结束回调会处理插入的专辑曲目、单曲循环和下一首，验收应覆盖这三条路径。[FitBay 播放结束逻辑](../components/music/component.tsx) · [MPD 播放选项](https://mpd.readthedocs.io/en/stable/protocol.html#playback-options)

## 导出本地歌单为 M3U8

用户想把排好的歌单交给另一个播放器时，可以从歌单菜单导出 UTF-8 的 `.m3u8`。现有「曲库备份」用于保存 FitBay 数据。这项候选只导出所选歌单的本地文件路径，按已保存的自定义顺序写入。保存前提示缺失文件数量；验收时用另一个播放器打开含中文名和空格的文件，核对曲序与可播放首数。KDE Elisa 的歌单保存功能可作为互操作参考。[FitBay 曲库备份](../components/music/LibraryTools.tsx) · [Elisa 手册 §2.1.2](https://docs.kde.org/stable5/en/elisa/elisa/elisa.pdf)
