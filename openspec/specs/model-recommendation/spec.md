# model-recommendation Specification

## Purpose

音乐组件提供可选择的模型服务，独立保护各服务的密钥并校验返回的曲单。遇到凭据、网络或数据错误时保留之前生成的推荐记录。

## Requirements

### Requirement: 多服务商音乐推荐

FitBay SHALL 默认选择 DeepSeek 并提供 OpenAI、Claude、Gemini，支持分别配置密钥和模型。

#### Scenario: 生成并匹配

- **WHEN** 用户向已配置的服务商提交偏好
- **THEN** 工作台保存经校验的五首推荐，并可搜索歌曲在线版本。
#### Scenario: 异常或取消

- **WHEN** 请求被取消、网络失败或返回无效数据
- **THEN** 展示错误且不写入部分记录。
