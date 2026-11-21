## Why

只安装工作台的用户需要从组件管理补装组件，并在操作前看清哪些组件已经可用。

## What Changes

为安装版的组件管理接入 GitHub 正式发行包、下载进度、失败重试和安装后发现。沿用现有产品标识和更新包校验。

## Capabilities

### Modified Capabilities

- `desktop-installation` 新增从设置安装组件。

## Impact

平台组负责设置页、专用 IPC 和发现逻辑。打包组提供同一正式版本的 x64 安装包及 GitHub SHA-256，组件沿用自己的启动和注册方式。
