## ADDED Requirements

### Requirement: 独立安装和使用

FitBay 工作台和 FitBay Music SHALL 使用各自独立的安装包、启动入口和卸载登记；支持当前用户自行选择安装目录。

#### Scenario: 仅安装一个产品

- **WHEN** 用户只安装工作台或只安装 Music
- **THEN** 所选产品可自行启动，Music 可独立播放本地音乐

#### Scenario: 同时安装

- **WHEN** 用户打开已安装的工作台和 Music
- **THEN** Music 可以停靠到工作台和分离，并保持原播放会话

#### Scenario: 移除其中一个

- **WHEN** 用户卸载任一产品
- **THEN** 保留另一产品的安装、启动入口以及用户数据

#### Scenario: 安装位置与个人文件

- **WHEN** 用户选择一个新的独立空目录，包括尚未创建的目录
- **THEN** 当前用户可以安装此产品，卸载时保留后来放入安装目录的个人文件

#### Scenario: 两个安装目录重叠

- **WHEN** 用户选择与另一产品相同的目录、其子目录或其上层目录
- **THEN** 安装器终止此次安装，原产品仍可启动
