## 实现及验收

- [x] 首次选择与升级隔离，核对旧目录和注册信息。
- [x] 本地目录扫描、用途、搜索、Skill 资源和实时核对。
- [x] 结构化详情、原文、变量和复制。
- [x] AI 整理、配置入口、预览与确认保存。
- [x] 独立及停靠真实入口验收，记录证据与边界。

独立与停靠组件实测使用开发版 0.1.0 和隔离 profile。新目录选择、正文检索、用途、结构化步骤和代码、原文、部分变量复制、外部修改、改名、删除和退出期间变化均通过。已确认取消整理不生成卡片，确认后生成独立 MD 副本，相对 Markdown 引用仍指向原 Skill 资源。AI 请求使用回环兼容端点。原配置及 Skill 子目录的写入保护另有宿主回归断言。

[桌面实测截图](../../../tmp/prompt-cards-6NHzpN/docked.png) 与 [复验脚本](../../../scripts/check-prompt-catalogue.mjs)。注册交接已发平台组，宿主和安装界面的显示名由平台组更新。未在发行包或真实商用模型上复验。工作区全量检查的其他组格式差异见 tmp/prompt-catalogue-check.log。

## 2026-11-27 阅读打磨

- [x] 首页搜索、粘贴和拖入提示；目录管理移入设置。详情独立滚动，保留当前标题和两种查看方式。「更多」展开后主动选择固定动作才出现连接和输入类型。
- [x] `node scripts/check-prompt-reading.mjs "D:/Desktop/Projects/Prompt repository"` 使用样例副本，从长文目录点到 OAuth Providers，定位、焦点与可见范围均正确；滚到文末展开更多后返回，原搜索、选中、列表位置均保留，110459 字节原文未改变。
- [x] 使用原生宿主尺寸与实际视图截图复验，取代早期 CDP 模拟视口截图。四种入口的实测 CSS 宽度约为独立 1174、半屏 774、窄窗 309、停靠 891。窄窗的系统比例 150%、页面缩放 125%，图层宽 579 像素。全页按钮、嵌套滚动区及段落、列表与代码各行均在可见宽度内。
- [x] 窄窗输入法组合事件提交「目录」后，点粘贴并展开表单，核实按钮右端可命中。使用 Chromium 组合事件，不操纵系统输入法候选窗。SDK 阅读时「原文」高亮，点「Markdown 源码」可看完整源文件。
- 验收同时保存 Electron 原始透明图层、按宿主深色回退底合成的同尺寸 PNG 及[视口数据](../../../tmp/prompt-reading-UQRGbE/geometry.json)。[窄窗列表](../../../tmp/prompt-reading-UQRGbE/narrow-list.png)、[窄窗 OAuth](../../../tmp/prompt-reading-UQRGbE/narrow-oauth.png)、[停靠阅读](../../../tmp/prompt-reading-UQRGbE/docked-oauth.png)。毛玻璃与物理桌面壁纸的最终 DWM 合成未捕获。

本组同次构建的 prompts/component.js SHA-256 为 `05D97F85887CD90E3F94D7220F7A3A6FB46B7FE40DCB667DFF2DC9E719E27B32`。

### Markdown 表格复验

从同一份《接入ai订阅.md》复现原版渲染 0 张表。修复后在独立、半屏、窄窗及停靠入口均读到 6 张表、79 行数据，首表首行为 OpenAI 和 OPENAI_API_KEY。实际 59 个目录链接均对应文内目标；点击 OAuth Providers 后标题可见并获得焦点。约 309 CSS 像素宽时，只在宽表内横向滚动，正文和页面无横向溢出。[窄窗表头与数据](../../../tmp/prompt-reading-xqJ3jx/narrow-table.png) · [OAuth 定位](../../../tmp/prompt-reading-xqJ3jx/narrow-oauth.png) · [窗口实测](../../../tmp/prompt-reading-xqJ3jx/geometry.json)
