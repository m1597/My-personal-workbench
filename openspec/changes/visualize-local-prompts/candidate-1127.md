# 提示词库固定候选交接 · 2026-11-27

组件 ID 为 `io.fitbay.prompts`。本组功能提交 `d59f28e`、验收记录 `8e0e007` 在候选历史中分别对应 `077bec4`、`4b7c530`，已纳入恢复候选 `d1b0330`、打包工作树 `0f680a3` 和桌面工作树 `492b263`。提示词库页面和渲染器在三者间没有源码差异。平台的公共选择器和模型继承随候选集成。无需重复摘取本组提交。

## 安装器载荷

本次从本地 `release/candidate/dist/installers` 下两份 0.2.5 x64 安装器解出内层 app-64.7z。SHA-256 与该目录 SHA256SUMS.txt 一致。

| 安装器                               | SHA-256                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| FitBay-Prompts-Setup-0.2.5-x64.exe   | 1567F149DB029A334F91224EA0DAF79756C01D9ED1DA8C7720F78C22B275C4CB |
| FitBay-Workbench-Setup-0.2.5-x64.exe | E720BE78E6B9A899A85D2C417D850CF5E5693DEC0C0CBE4D0E14217D6E653D55 |

独立程序入口为 FitBay Prompts.exe。工作台从已安装组件打开提示词库。两个产品的资源根均为各自的 `resources/app`，主进程入口为 `host/main.mjs`。两份载荷均包含 `host/prompt-model.mjs`、`host/prompt-visuals.mjs` 和 `host/archify`。Archify 3.2.0 的 38 份渲染模块、语言资源及许可文件逐一与固定候选 Git blob 比对，两个产品各为 38/38。独立渲染不依赖用户安装 skill。

分别调用两份解出载荷的 promptVisuals，用固定模型响应生成双节点有向图；两次均核实 SVG 节点和独立 HTML 中的软件声明。打包组可在候选根使用 `node scripts/check-prompt-visual-package.mjs <隔离安装根目录>` 复验。

## 桌面开发构建

从 D:/Desktop/FitBay.cmd 指向的工作树读取现有 dist 与 out，使用后台 Electron、独立 profile 及回环模型完成独立到停靠的专项。开发样本流程有回路并可点击回到原句，3D 材质卡和 SKILL.md 可读。导出 HTML 可缩放；重开命中缓存，外改提示更新，外删清理卡片。专用模型和恢复继承均核对了实际请求；拒绝无原文依据的结果后两份导入原文保留。实测脚本为 scripts/check-prompt-visuals.mjs。[流程图](../../../tmp/candidate-handoff-77f1bc2f/tmp/prompt-visuals-whtKKy/flow.png) · [独立 HTML](../../../tmp/candidate-handoff-77f1bc2f/tmp/prompt-visuals-whtKKy/flow.html)

前端 component.js 在安装包中的 SHA-256 为 A61D1A14E28AE15D5D6F6B5EFC5C1C59689444F94EBDB93EC0667E5A8D6635B7，桌面开发产物为 4A5BC04E2FCECA06B784A8C546A7F5ACDC186E910F839BA576441655366E6B16。两份证据绑定各自的产物。此次核验未发现提示词库渲染依赖缺失。安装器实际覆盖安装、最终整套发行产物仍由集成与打包验收绑定同一候选；真实模型对用户提示词的整理质量另列用户验收。

## 阅读与布局修复的后续交接

旧候选后的组件提交为 `f048783` 和 `771afa7`，另见本分支后续的原文标签与窄窗可见范围修复。本轮在本组实际 Electron 构建使用隔离配置。[长流程与并发复验](tasks.md) · [长文、实际窗口尺寸、原始透明图层与合成截图](../curate-local-prompt-library/tasks.md)。本轮未更新上述 0.2.5 安装器。
