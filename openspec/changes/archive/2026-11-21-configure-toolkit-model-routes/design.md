## Context

原设置位于公共用户 profile 下的 toolkit/settings.json，密钥由 Electron safeStorage 保护。

## Decisions

使用工作台组的共享主进程连接接口。文字翻译、划词解释和文字动作使用文字绑定，视觉问答和图像动作使用视觉绑定，追问继承首轮用途。配置通知只传脱敏快照。保留已有工具开关和快捷键。

## Risks / Trade-offs

旧连接有加密凭据时，需要在能解密的 Windows 用户会话中迁移。配置缺失时结果窗保留输入，提供对应设置入口。
