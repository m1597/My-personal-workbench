固定提示词为工具集动作

修改「解释推导」后再次截图使用新模板；删除文件返回 FILE_UNAVAILABLE。

采用现有 Electron 宿主与独立组件资源。目录读取和本机快捷键由可信主进程处理。

参考 [Node 文件系统](https://nodejs.org/api/fs.html) 的文件读取与变更语义，以及 [Electron globalShortcut](https://github.com/electron/electron/blob/main/docs/api/global-shortcut.md) 的注册失败返回。
