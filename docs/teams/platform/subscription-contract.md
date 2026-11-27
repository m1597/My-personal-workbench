# 组件订阅调用契约

适用 Music、提示词库、工具集的主进程，基线 87fe3e0。平台负责连接选择、OAuth 和请求；组件负责用自己的输入构造任务、解析结果及显示错误。以下为本轮约定，落地与实测状态以平台提交为准。

沿用 `openConnections(profile, vault)` 和现有用途 `music.model`、`prompts.model`、`toolkit.translation`、`toolkit.vision`。组件首先读取有效连接。用途专用优先，清除后继承全局默认。旧调用方的 API Key 连接沿用原协议与 `resolve(use)`。

```js
const use = 'music.model'
const connection = store.connections?.read(use)
if (connection?.authType === 'subscription') {
  const text = await store.connections.requestPlan(use, {
    instructions,
    input: JSON.stringify(payload),
    signal,
  })
  return JSON.parse(text)
}
```

`requestPlan` 返回 Promise<string>。图像输入可传 Responses 的用户消息数组，内容含 input_text 和 input_image；平台以账号目录的模型输入能力校验。通过平台调用后，错误原样传回设置或功能入口；组件收到拒绝、过期、额度或不支持的模型，应结束本次调用并提示处理。禁止在同一操作中再用 API Key 重试。渲染进程只接收能力和状态，令牌属于主进程。
