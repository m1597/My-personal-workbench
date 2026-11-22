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
