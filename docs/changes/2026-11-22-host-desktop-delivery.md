# 桌面工作台宿主交接 · 2026-11-22

桌面 FitBay.cmd 调用本仓库 scripts/open-workbench.cmd。已构建开发版 0.1.0。宿主功能提交为 52a318d、67c06cf，跨组独立复验为 18f1f4a。

| 项目            | 实际操作和观察                                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全局设置 → 更新 | 从齿轮主动检查真实发行服务。FitBay、Music 显示本地 0.1.0、可用 0.2.1；提示词库、工具集显示未接入在线更新。页面只有一条开发构建说明。视口 1175 与 535 CSS 像素时横向溢出均为零，窄窗操作组独立换行。[宽窗](../images/host-update-layout/wide.png) · [窄窗](../images/host-update-layout/narrow.png)              |
| 分屏与恢复      | 以隔离配置从桌面脚本启动，依次打开提示词库、工具集、Music。中央分隔线拖至最右侧再由布局菜单恢复，四格及右下快速开始全部返回，逐格宽高相等。四向专项另覆盖收起后重启和嵌套比例。[原始尺寸](../images/host-update-layout/four-restored.json) · [独立复验截图](../images/integration-desktop-1122/right-fixed.png) |
| 标签与眼睛      | Music、工具集混合分组反复切换，标签栏为 38 CSS 像素。图标、关闭按钮垂直居中，同排内容起点一致。桌面脚本验证工具集未打开、隐藏、显示，提示词库收起后再用眼睛显示。复验脚本为 scripts/check-host-component-tabs.mjs 和 scripts/check-desktop-eye-updates.mjs。                                                    |
| 共享快捷键      | 控件位于 src/renderer/src/app/ShortcutRecorder.tsx，组件通过 saved、defaultValue、label、local 与 change 接入。录制支持功能键、组合键、Esc 取消、退格清空、保存和单项恢复默认。回调失败显示可重试提示。Music 独立及停靠的保存、恢复及重启通过，提交 792aab5。提示词库独立验证见 f6c9a5c。                       |
| 工具集          | 用宿主滑块改变材质，核对独立工具集与停靠设置页。工作台与工具集的实际 Tray 实例数，按宿主、独立、宿主、独立四次切换分别为 1+0、1+1、1+0、1+1。设置与材质截图保存在 tmp/toolkit-shell-imnPRJ。Windows Explorer 的任务栏分组复验见[集成记录](2026-11-22-desktop-independent-acceptance.md)。                       |

npm run build:prototype、桌面启动脚本 --check、两个相关 OpenSpec change 与 workspace-components 的严格校验通过。两套交互回归各 17 项通过；最后修复空格恢复后另从桌面入口和四向专项复验。全仓 npm run check 停在其他交接文档的 Markdown 表格格式。开发目录多人并行构建，集成记录附独立验收时的构建指纹。

指定参考 PNG 可读；录屏未在给定 D:/Desktop 路径找到。采用真实桌面组件顺序和分隔线端点坐标复现。系统通知区（含隐藏图标）的全局人工计数、远程 CI 及新发行包安装不在本次实测结果内。

## 工具集退出联动复验

宿主提交 0907658 随每次停靠启动传递实际宿主 PID。重建后运行 scripts/check-toolkit-shell.mjs，确认宿主退出时纯停靠的工具集进程退出，已打开的独立工具集仍可用。平台复测目录为 tmp/toolkit-shell-uHwWNd。用同一构建重新打开八个组件、测试标签切换和重启，通过记录位于 tmp/default-grid-IzA66J 与 tmp/host-tabs-SgLv4x。单独执行 npm run lint 通过。

本次联测宿主 main.mjs 的 SHA-256 为 A19BED31B5332FA7D12290437204840572EEF78F2CB2BE8CD7527CBF7B46CB0D，工作台 renderer 入口脚本为 B937475DC5F8FE505AC212F0B7C02CBEF4B435EAA6C6554289048806DA31F7F2。工具集验收另见[组件组交接](2026-11-22-toolkit-runtime.md)。
