## 实现

- [x] 1.1 接入工具集与文件库显示名和工具箱图标，沿用已安装组件标识。

## 桌面实测

- [x] 2.1 验证两个入口、工具集图标和旧布局恢复。

## 结果

从快速开始分别打开工具集与文件库，在组件菜单再次打开工具集后仅有一个对应标签。工具集快速开始、菜单及标签使用组件组交付的 src/renderer/public/toolkit.png。为隔离资料写入旧中文标题，关闭并重启，确认 component-toolkit 与 component-prompts 均恢复新标题，原分组及数量不变。组件首页工具与系统外壳图标由各组件组验收。

[快速开始](../../../../tmp/host-tabs-hbg4aD/quick.png) · [旧布局恢复](../../../../tmp/host-tabs-hbg4aD/restored.png) · [复验脚本](../../../../scripts/check-host-component-tabs.mjs)。

桌面 FitBay.cmd --verify-desktop 实测三个宿主入口，在[组件菜单](../../../../tmp/desktop-check-29545-4223/menu.png)也确认同一工具箱图标。

## 宿主交接

工作台平台与体验组牵头。宿主提交 a45142b、c764d7b、04ba3af、3b18712 对应标签几何、入口与图标、无障碍标题和桌面复验。当前兼容范围包括已登记的 toolkit、prompts 产品和 component-toolkit、component-prompts 面板；旧实时布局、命名快照沿用同一恢复逻辑。组件继续使用原 preload 调用，工具集组提供工具箱资源，文件库组维护自身窗口内容。后续若变更共享接口，平台组先与调用方约定兼容范围及复验入口。

宿主自测使用隔离 profile。工作区集成构建和桌面启动检查通过，全仓 OpenSpec 严格校验 57 项通过。并行开发工作树的 npm run check 在其他组件的格式检查处停止。隔离宿主提交后，生产交互 16 项一次通过，开发交互首轮 3 项超时或未等到标签；重跑开发全套时 15 项一次通过，另 1 项拖拽用例重试通过。保留[项目检查日志](../../../../tmp/host-tab-project.log)、[隔离检查日志](../../../../tmp/host-isolated-final.log)及[开发模式复验日志](../../../../tmp/host-development-retest.log)。集成验收组可按需使用相同脚本复验；发布包和其他显示器缩放未在本轮验收。
