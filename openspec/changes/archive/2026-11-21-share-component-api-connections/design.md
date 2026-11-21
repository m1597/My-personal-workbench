## Context

跨组件 API 与模型配置

## Decisions

按已安装组件及用途登记绑定。组件入口和全局列表使用同一个连接接口，列表仅显示非敏感字段。保存、读取密文及调用服务均在主进程完成。

## Validation

使用独立资料从桌面入口验证各情景，并记录截图和限制。

## 组件接入契约

公共模块为 `examples/component-host/api-connections.mjs`，主进程调用 `openConnections(sharedProfile, safeStorage)`。独立组件与工作台传入相同的 FitBay profile，开发测试传入同一隔离目录。组件入口只允许读写自己的用途，跨组件选择通过已有连接 ID 完成。

- `read(use)` 返回空值或公开字段 id、endpoint、model、protocol、configured。
- `choices()` 返回上述公开连接列表。
- `write(use,{reuse:id})` 显式复用连接。保存独立连接使用 `write(use,{separate:true,endpoint,model,key,protocol})`。空 key 在同地址编辑时保留原密钥；换地址须重填。
- `importLegacy(use,{endpoint,model,encrypted,protocol})` 仅在未绑定时导入，encrypted 为原 safeStorage 密文字节。
- `resolve(use)` 仅供主进程在 API 请求时获取凭据。对外错误应为固定提示。
- 用途标识为 music.model、toolkit.translation、toolkit.vision、prompts.model。协议值为 chat、responses、claude、gemini。
