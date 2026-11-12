# music-preferences Specification

## Purpose
在本机保存用户生成的偏好资料，管理向模型发送的信息并在失败后保留已有资料。用户可以跨次使用保存的资料，并能在设置中了解资料的用途。

## Requirements

### Requirement: 可复用音乐偏好

系统 SHALL 持久保存成功生成的资料，并在外发前展示实际使用的信息。

#### Scenario: 生成和复用

- **WHEN** 用户同意自述或预览的曲库信息并生成资料
- **THEN** 保存资料供查看，重开后可附加当次风格生成推荐，无需再次发送曲库信息

#### Scenario: 更新失败

- **WHEN** 更新失败或取消
- **THEN** 上次成功保存的资料仍可使用
