## Context

在 PDF 阅读器选择文字后按快捷键，展示所选原文及翻译、解释和自由提问入口。

## Decisions

按下快捷键时记录前台 HWND。Windows 复制后对照剪贴板序号、拥有者进程和当前焦点；只有来自目标的新增文本才进入面板。无人改写时恢复此前的剪贴板对象。Chrome PDF 的 UI Automation 读取曾导致 PowerShell 子进程异常，故选用复制入口。STranslate 为 MIT 的 WPF 工具；本组件沿用 Electron，不引入其二进制、插件或资源。https://github.com/STranslate/STranslate

## Risks / Trade-offs

没有选中文字：显示重新选择提示，不把旧剪贴板当作选区。
