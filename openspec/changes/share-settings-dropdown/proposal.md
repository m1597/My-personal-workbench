# 工作台设置卡片与公共下拉框

## Why

平台提供 Music 同源 Dropdown 和 ChoiceDropdown，设置卡片共享间距及材质；组件组迁移各自入口。ESLint 接入统一检查与 Windows CI。

## What Changes

- 两个弹层继承深色材质，可以选择协议并通过键盘关闭。平台及 Music 使用同一弹层实现。

## Impact

- 平台维护宿主接口与设置入口，组件及打包组验证各自交付。
