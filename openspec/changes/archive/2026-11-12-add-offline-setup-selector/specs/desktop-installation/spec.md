## ADDED Requirements

### Requirement: 离线安装选择

Windows x64 离线入口 SHALL 默认只安装工作台，允许用户勾选 Music，并保留独立补装 Music 的途径。

#### Scenario: 勾选 Music

- **WHEN** 用户在离线入口勾选 Music
- **THEN** 入口先运行工作台安装器，成功后运行 Music 安装器

#### Scenario: 稍后补装

- **WHEN** 用户首次仅选择工作台，之后运行独立 Music 安装器
- **THEN** 用户可补装 Music，无需重新运行工作台安装器
