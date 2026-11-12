## Context

两个已存在的独立 NSIS 安装器分别管理各自的登记、文件与卸载。

## Goals / Non-Goals

离线入口可选 Music。首版插件延期。

## Decisions

外层 NSIS 使用必选工作台和默认未选的 Music 两个安装节。把现成安装器原样嵌入，按选择解包并等待子向导退出。构建完成后最后替换 SHA-256 清单。

## Risks / Trade-offs

单文件入口包含两份 Electron 运行时。第二步失败时保留第一步的成果，用户可单独补装 Music。
