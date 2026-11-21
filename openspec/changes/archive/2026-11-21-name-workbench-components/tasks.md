## 实现

- [x] 1.1 接入工具集与文件库显示名和工具箱图标，沿用已安装组件标识。

## 桌面实测

- [x] 2.1 验证两个入口、工具集图标和旧布局恢复。

## 结果

从快速开始分别打开工具集与文件库，在组件菜单再次打开工具集后仅有一个对应标签。工具集快速开始、菜单及标签使用组件组交付的 src/renderer/public/toolkit.png。为隔离资料写入旧中文标题，关闭并重启，确认 component-toolkit 与 component-prompts 均恢复新标题，原分组及数量不变。组件首页工具与系统外壳图标由各组件组验收。

[快速开始](../../../../tmp/host-tabs-R6RvSW/quick.png) · [旧布局恢复](../../../../tmp/host-tabs-R6RvSW/restored.png) · [复验脚本](../../../../scripts/check-host-component-tabs.mjs)。
