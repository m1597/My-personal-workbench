从外部应用调用提示词

从输入框按热键、搜索、Enter，文本进入原输入框；失败可复制。

采用现有 Electron 宿主与独立组件资源。目录读取和本机快捷键由可信主进程处理。

参考 [Node 文件系统](https://nodejs.org/api/fs.html) 的文件读取与变更语义，以及 [Electron globalShortcut](https://github.com/electron/electron/blob/main/docs/api/global-shortcut.md) 的注册失败返回。
