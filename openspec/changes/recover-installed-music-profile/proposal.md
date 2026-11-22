## Why

安装版和桌面开发版可以持有不同资料。已有用户在旧资料中关注了歌手，升级后需要找回关注与 Music 专用模型，并能验证旧连接实际可调用。

## What Changes

- 同资料目录覆盖升级保留关注及专用模型。全局默认连接存在时仍检查旧 Music 密钥。
- Music 设置的「本地曲库 → 备份与恢复」可选择旧 FitBay 资料目录，合并关注，恢复缺少的专用连接并显示结果。

## Capabilities

### Modified Capabilities

- `music-library-tools`：恢复旧资料中的关注歌手。
- `component-api-connections`：旧 Music 专用连接恢复与覆盖升级保留。

## Impact

Music 维护资料读取、UI、实际请求探针。平台维护默认连接与系统保护存储。打包组在隔离 Windows 安装环境跑发布版及覆盖升级后的相同探针。
