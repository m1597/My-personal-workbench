## 实现与验收

- [x] 详情可在可视化与原文间切换。按原文逐字核对节点与连线，使用随产品分发的 Archify 绘制包含回路的开发流程，3D 描述分组，短文支持复制。
- [x] 测试独立窗口手动生成、停靠窗口导入自动生成、下拉展开、模型来源切换，以及原句定位和独立 HTML 缩放。
- [x] 重开命中缓存且模型调用次数不变；外部修改后提示待更新；批量导入中无依据的模型响应被拒绝，原文件仍可用。
- [x] 实测导出至 Skill 目录遭拒，原有文件不变。验证两个开发包暂存目录从自带模块独立绘图。
- [x] 公共设置双向编辑与凭据遮盖，以及快捷键取消、冲突、恢复默认、重启、设置具体控件焦点均通过隔离 Electron 回归。

### 复验与打包交接

基线为 FitBay 0.1.0，保留组件 ID `io.fitbay.prompts`。公共下拉与默认连接继承依赖平台提交 `8ee47c6`、`534bab5`，本分支对应 `d9906ac`、`946c0b0`。从本组工作树执行 `npm ci`、`npm run build:prototype`，再执行：

- `node scripts/check-prompt-visuals.mjs`。隔离启动独立组件，随后从齿轮「目录」加入工作台。三个样本分别命中专用、全局、全局模型。本机证据 [开发流程](../../../tmp/prompt-visuals-7szn68/flow.png)、[3D 信息卡](../../../tmp/prompt-visuals-7szn68/scene.png)、[连接菜单](../../../tmp/prompt-visuals-7szn68/connection-dropdown.png)、[可独立打开的 HTML](../../../tmp/prompt-visuals-7szn68/flow.html)。服务由回环端点提供固定结构，公网模型的生成质量另验。
- `node scripts/check-prompt-connections.mjs`、`node scripts/check-prompt-shortcuts.mjs`、`node scripts/check-prompt-catalogue.mjs`。证据目录分别为 `tmp/prompt-connections-AnBYhp`、`tmp/prompt-shortcuts-Buth23`、`tmp/prompt-cards-zbAHOY`。
- `node scripts/check-prompt-visual-package.mjs`。重建 Prompts 和 Workbench 的打包暂存目录，用各自随包的渲染器绘图并检查入口和许可。安装布局以现有无 asar 配置为准。在两个产品的 `resources/app/` 下均须包含 `host/main.mjs`、`host/prompt-visuals.mjs`、`host/prompt-model.mjs`、`host/archify/renderers/`、`host/archify/locales/` 和 `host/archify/{LICENSE,LICENSE-MIT,NOTICE,THIRD_PARTY_NOTICES.md}`。独立产品另含 `prompts/index.html`、`prompts/component.js`、`prompts/component.css`。安装后启动 `FitBay Prompts.exe` 或从工作台打开已安装的提示词库。独立安装器安装与打包后启动由集成验收组复验。

### 渲染器与接口

复用 [Archify 工作流编译器](https://github.com/tt-a1i/archify) 本机 3.2.0 版本及其所需模块。Apache-2.0、历史 MIT 和第三方声明随包保留，移除可选品牌标志数据。独立 HTML 内嵌软件声明。编译过程使用包内 JavaScript 和 JSON，不需要安装 skill 或额外 npm 包。

编辑器的专用 preload 提供 `visual(root,name,generate)`。仅显式生成时解析有效的 `prompts.model` 并请求模型；结构在本地校验后缓存于 profile 的 `prompt-library/visuals-v1`。缓存按路径区分，以原文修订号判定是否可用。无缓存读取返回空视图，过期返回 `stale: true`；模型错误、无效引用或并发修改均可重新生成。`exportVisual(root,name)` 读取当前有效版本，系统对话框取消返回 false，成功返回 true。

本组功能提交 `d59f28e`。两个暂存产品的渲染入口复验通过，记录为 `tmp/staged-visual-Dpp0Bf`。类型检查与两个 OpenSpec 严格校验通过。全仓 `npm run check` 在六份已有 `docs/changes` 文档的格式检查停止，完整日志见 `tmp/visual-check.log`。桌面 FitBay.cmd 当前指向 `D:/Desktop/Projects/FitBay/workbench/scripts/open-workbench.cmd`；由集成负责人将本提交纳入该构建。本组未执行发行、远程 CI 或安装器验收。

## 2026-11-27 布局可靠性

- [x] 用分窗样例的连续逐字引用复现同一行 6 节点成功、7 和 24 节点失败。流程转换为三列多行；紧凑布局容纳不了的原句使用按行换行的纵向布局，所有方向、分支、长边和回路保留。恢复在宿主本地完成。
- [x] `node scripts/check-prompt-layout.mjs` 实测六种组合。分别生成 6、7、24 个节点的紧凑及长文案流程，包含首末双向边。由真实组件打开图，点首节点核对引用、放大到 150%、通过导出按钮写 HTML 并另窗打开。核对节点和边数、SVG 一致性与标签边界，包含 40 个大写 W 的宽字符样本。变更后模拟连接失败，旧图仍可读，过期图无法作为新图导出。
- [x] 并发测试让 A 的回环响应延迟至切换到 B 之后返回，确认 B 的 150% 缩放与选中原句保留。回环数据与真实模型验收分开记录。证据目录 `tmp/prompt-visuals-84PzJj`。

同一份《修复分窗收起问题.md》的产品入口已用回环模型跑通 7 节点、点回原句、重开缓存，首次/重开请求计数为 1/0。该次是脚本对照。真实模型复验命令为 `node scripts/check-prompt-sample.mjs <样例文件> <获准连接profile>`，只读取选定提示词用途的受保护连接，在隔离目录完成。桌面「提示词库」已有专用连接，实际向此服务发送样例的确认待回复。

### 两个生成入口的状态复验

独立与停靠组件复验使用受控回环端点。通过页签和正文按钮分别触发慢响应，两处同时显示「正在生成…」并禁用，分别只发一次请求。缓存文件路径被目录占用时出现读取错误，移除障碍后点击「重试读取缓存」恢复，模型调用次数仍为零。引用校验失败后两处可重试；切换文档后旧请求完成，新文档仍保留原句与 150% 缩放。6、7、24 节点原有布局回归通过。复验命令为 `node scripts/check-prompt-visuals.mjs`，隔离产物在 `tmp/prompt-visuals-Z93062`。

### 重复原句回归

以「检查步骤。」分别出现在偏移 32 和 38 的样本，从独立组件打开流程，并用实际导出按钮生成 [HTML 样例](../../../tmp/layout-TjXbt8/重复引用.html)。两个节点分别提供正确偏移、相邻上下文，两处渲染均高亮对应位置。无证据及错位 37 的节点均先显示「原文有多处匹配」，不预选；逐次点击后才高亮 32、38。现有 6、7、24 节点及可视化入口回归通过。复验命令为 `node scripts/check-prompt-layout.mjs`。

### 0.2.7 后续验收

详情打开同目录 Archify HTML。首次生成后交给系统浏览器，重开直接复用；原文更新需主动重新生成，失败保留旧版。同名无关 HTML 不覆盖。测试使用用户样例副本。

隔离独立窗口与停靠入口复验通过（tmp/prompt-visuals-KxH8Ca）。系统打开 HTML 的调用在测试中截获，同一文件用隐藏 Chromium 窗口载入，核对 Archify 图、原句和图下卡片。6、7、24 节点与重复引用复验见 tmp/layout-W6Dljg。独立组件及工作台的本地打包预备目录均能加载官方模板、字体许可与渲染器，入口 host/main.mjs。通过 `node scripts/check-prompt-plan.mjs 9fda247` 验证平台无 Key 订阅的全局继承和用途覆盖，使用隔离临时凭据、受控流式响应。真实账号、物理默认浏览器和发行安装未测。
