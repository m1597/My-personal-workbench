## 设计

入队前按录音标识核实可播放的本地副本并预留待传输项目，避免跨歌单或连续点击导致重复下载。与所选歌曲共享串行传输和任务面板；逐首捕获失败并保留失败 ID。保留在线歌单引用，播放入口会先核实本地副本。恢复丢失的已索引文件时，以原 ID 事务更新路径和元数据；路径属于其他条目或有文件时保留原文件。缺少目录配置时仍按既有手动下载流程选择。

上游 LX Music Desktop 以选择的任务子集重新启动下载，本变更保留失败成员 ID 并交给 FitBay 现有下载器处理。仅参考交互行为，未引入依赖或复制代码。[上游任务操作](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/views/Download/useTaskActions.js)
