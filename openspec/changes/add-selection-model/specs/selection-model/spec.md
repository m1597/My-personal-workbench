## ADDED Requirements

### Requirement: 选区模型问答

工具集 SHALL 支持选区模型问答。

#### Scenario: 从桌面入口使用

- **WHEN** 用户发起选区模型问答
- **THEN** 截图翻译使用 Windows OCR，视觉问题发送裁剪原图；结果可复制、固定和继续追问。

#### Scenario: 模型失败

- **WHEN** 模型失败
- **THEN** 鉴权、超时或不支持图片时显示错误，保留选区，允许修改配置并重试。
