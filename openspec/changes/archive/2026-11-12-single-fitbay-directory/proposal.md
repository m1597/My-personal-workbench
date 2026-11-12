## Why

用户已经安装过工作台，原来的两个向导要求选两次目录，而且会拒绝把 Music 装进工作台。用户希望在首次安装和后续补装时得到同一个目录结构。

## What Changes

- 合并目录选择，支持工作台在根目录、Music 在直接子目录的组合安装和独立补装。

## Capabilities

### New Capabilities

### Modified Capabilities

- `desktop-installation` 修改离线选择、独立安装与重叠路径的约束。

## Impact

涉及 NSIS 分发入口、子产品校验、默认目录、卸载和打包验收。
