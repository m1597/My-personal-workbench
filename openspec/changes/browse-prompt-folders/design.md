本地提示词目录与编辑

临时打开 B 后重启回到默认 A；外部修改自动刷新，未保存草稿保留并可重新加载。

采用现有 Electron 宿主与独立组件资源。目录读取和本机快捷键由可信主进程处理。

参考 [Node 文件系统](https://nodejs.org/api/fs.html) 的文件读取与变更语义，以及 [Electron globalShortcut](https://github.com/electron/electron/blob/main/docs/api/global-shortcut.md) 的注册失败返回。
