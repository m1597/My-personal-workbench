## ADDED Requirements

### Requirement: 按用途继承默认连接

平台 SHALL 工作台 API 与模型提供默认连接、设为默认和恢复默认。组件使用同一存储，专用配置优先。

#### Scenario: 默认连接仅支持文本，Music 有专用连接

- **WHEN** 默认连接仅支持文本，Music 有专用连接
- **THEN** Music 使用专用配置，工具集翻译继承默认，视觉用途要求视觉能力。恢复默认后其他窗口立即读取继承值。
