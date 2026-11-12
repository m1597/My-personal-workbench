# desktop-installation Specification

## Purpose

规定 Windows 上工作台和 Music 的独立安装、启动、发现与卸载行为。用户可以只安装其中一个产品，也可以同时安装并共用播放会话。两者使用各自的程序目录，并在卸载时保留用户文件和另一产品的相关登记。

## Requirements

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

- **WHEN** 用户选择与另一产品相同的目录，或除工作台与其直接 Music 子目录之外的上下层重叠目录
- **THEN** 安装器终止此次安装，原产品仍可启动

### Requirement: 离线安装选择

Windows x64 离线入口 SHALL 默认只安装工作台，允许用户勾选 Music，只选择一次工作台根目录，并将选中的 Music 安装到其直接 Music 子目录。

#### Scenario: 勾选 Music

- **WHEN** 用户在离线入口勾选 Music
- **THEN** 只选择一次根目录，入口依次把工作台安装到该目录、把 Music 安装到其 Music 子目录

#### Scenario: 稍后补装

- **WHEN** 用户首次仅选择工作台，之后运行独立 Music 安装器
- **THEN** Music 安装器自动预填已登记工作台的 Music 子目录，可直接补装
