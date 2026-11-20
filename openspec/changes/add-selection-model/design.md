## Context

截图翻译使用 Windows OCR，视觉问题发送裁剪原图；结果可复制、固定和继续追问。

## Decisions

Windows OCR 在本机处理 PNG。主进程保存会话，凭据用 Electron safeStorage 加密；仅用户主动发起的请求携带对应输入。

## Risks / Trade-offs

模型失败：鉴权、超时或不支持图片时显示错误，保留选区，允许修改配置并重试。
