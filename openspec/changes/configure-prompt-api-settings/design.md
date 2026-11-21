## Context

工作台和组件可以分别启动，模板读取接口已由工具集在执行时调用。连接信息通过宿主读取同一 profile 的共享配置。

## Decisions

本地目录、搜索和插入流程直接启动。组件页面仅在用户打开设置或展开固定动作时查询配置。写入范围固定为仓库的用途；工具集连接仅展示脱敏摘要。界面不接收已有 Key；更换 Key 的输入默认遮盖，离开表单即丢弃。普通错误使用不含提交内容的消息。

## Recovery

配置读取失败时保留本地页面并提供重试。外部更新时同步状态；避免以旧表单覆盖新的连接信息。

采用公共模块 openConnections 的 prompts.model 绑定，固定动作分别读取 toolkit.translation 与 toolkit.vision 的公开字段。主进程监听 SQLite 文件变化触发重新读取。凭据由公共模块在 Windows 上使用当前用户的 DPAPI 保护。旧配置由公共模块负责迁移。

参考 [Electron safeStorage 文档](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md) 的主进程凭据保护边界。组件使用工作台的公共凭据模块，以便独立进程访问同一份连接。
