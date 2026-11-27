## Why

Windows 逐项显示工作台和组件，用户会把单项卸载误认为整套卸载。旧组件可能装在独立磁盘目录，切换应用入口仍需保留已生效的位置与数据。

## What Changes

- 提供一个 FitBay Windows 安装项，保留组件升级使用的产品 GUID 和独立维护接口。
- 从整套卸载入口协调各产品的受控卸载，并记录原位置供重新安装。

## Capabilities

### Modified Capabilities

- desktop-installation：统一当前用户的安装登记、旧目录接管、单项与整套维护。

## Impact

影响 Windows 安装器、卸载器及安装版宿主的组件位置发现。项目 CMD 不进行 Windows 安装登记。
