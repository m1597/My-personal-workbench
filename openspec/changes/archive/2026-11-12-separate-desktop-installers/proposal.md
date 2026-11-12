## Why

用户希望自己决定是否安装工作台、Music 以及每个 Music 插件，并在两款应用同时安装时继续使用已有的停靠体验。

## What Changes

分别构建和交付两个 Windows x64 安装程序。Music 在设置中通过系统选择器安装单个本地插件，交付三份独立文件。公共发布仓库及在线插件分发留待以后。

## Capabilities

- desktop-installation：工作台和 Music 的独立安装、发现与卸载。
- music-optional-plugins：选择本地文件，其他插件保持未安装。

## Impact

Windows 安装器、已安装模式下的公共宿主、启动入口、安装位置登记、Music 插件设置、构建流程及安装验收。
