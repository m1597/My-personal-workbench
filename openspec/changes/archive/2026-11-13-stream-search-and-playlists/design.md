# 设计

Electron 自定义协议支持流式响应。主进程按单次播放授权代理字节范围请求，校验地址和重定向。渲染层仅获取 FitBay 播放地址。参考 [Electron protocol](https://github.com/electron/electron/blob/main/docs/api/protocol.md)。

SQLite 歌单允许本地和在线成员。在线成员按原音源、平台与录音标识去重，并保存可重取录音的最少资料。自定义搜索源重启后按原标识匹配原始行，保留上游试听条件。播放时才解析临时地址，暂停、切换或关闭播放器即取消请求。
