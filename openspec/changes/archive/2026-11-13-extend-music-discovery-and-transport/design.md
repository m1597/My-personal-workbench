# 设计与调研

- 歌手用 MusicBrainz 艺人 MBID 区分同名者，发行目录按具体 release 而非专辑名称取得多碟曲目。查询按需发起，限制请求频率。核心元数据按 CC0 使用，不取得音乐或封面。[MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) · [数据库许可](https://musicbrainz.org/doc/About/Data_License)
- 离线 PCM 短窗能量用于检测持续有声段和静音边缘。随机播放仅在能分析前后两首的情况下短暂交叉淡化；整张专辑顺序播放按自然结束换曲。参考 librosa 的 RMS（ISC）及 Mixxx 的 Auto DJ cues（GPL），在 FitBay 独立实现，未引入上游代码或依赖。[librosa](https://github.com/librosa/librosa/blob/main/librosa/feature/spectral.py) · [Mixxx](https://github.com/mixxxdj/mixxx/wiki/Auto-Dj-Cues)
- 批量下载对现有选区逐项处理；跳过已验证的本地副本。成功保存后关联原在线录音 ID，歌单及队列使用原身份。参考洛雪桌面的多选下载交互，Apache-2.0，自行实现。[洛雪音乐桌面](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/views/List/MusicList/useMusicDownload.js)
