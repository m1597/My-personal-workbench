# FitBay

本地优先的个人创作工作台。目前实现真实组件的拖拽、停靠、分组、缩放、关闭重开、最大化与布局恢复。

技术栈：Electron + React + TypeScript + Vite，Dockview 布局。视觉为微软 Fluent 磨砂玻璃，固定深色；中文优先本机 HarmonyOS Sans SC，回退微软雅黑 UI。记住上次布局；首次启动使用空工作区，全部关闭的空工作区也会保留。

## 组件产品方向（已确认公共宿主方案 B）

工作台与音乐/资产等组件分别安装，组件可独立启动，也可接入工作台停靠与分离。方案见 [组件框架设计](docs/组件框架设计.md)。已有独立部署的示例宿主原型，尚未集成到正式安装包或开放第三方接入；第一方Music进入一期，见 [一期任务](openspec/changes/add-music-recommendation-audition/tasks.md)。

## 开始开发

已验证 Windows、Node **24.19.0**、npm **11.17.0**。在仓库目录执行：

```powershell
npm ci
npm run check
npm run dev
```

npm ci 按锁文件安装，通过项目 postinstall 下载 Electron，不安装全局工具。自动检查在后台运行，不抢占桌面。已可生成 Windows x64 本地试用安装包。

| 命令                          | 用途                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| npm run doctor                | 只读检查版本、依赖、锁文件和必要配置                            |
| npm run dev                   | 启动桌面开发窗口                                                |
| npm run dev:web               | 浏览器预览，http://127.0.0.1:5173，无系统桥接                   |
| npm run format / format:check | 写回格式 / 只检查格式                                           |
| npm run lint / typecheck      | 静态 / strict 类型检查，含测试和构建配置                        |
| npm run build                 | 类型检查并构建至 out/                                           |
| npm start                     | electron-vite preview 构建后启动桌面程序                        |
| npm test                      | 构建并执行发布、开发两套 Electron 交互测试                      |
| npm run check                 | 环境、格式、静态、类型、构建、30 项交互及 doctor 回归的统一入口 |

统一检查只执行一次类型检查和生产构建。失败从终端首个错误看起，报告打开方法见开发流程。2026-11-09 已按用户授权推送，[首次 Windows CI](https://github.com/m1597/My-personal-workbench/actions/runs/42599390733) 已通过（提交 8af4c32，含 10 项交互测试）。

## 文档入口

- [需求与规划](docs/需求与规划.md)：已确认、候选与待办。
- [架构说明](docs/架构说明.md)：目录、调用关系与权限边界。
- [开发流程](docs/开发流程.md)：环境、OpenSpec 标准变更、验证和提交步骤。
- [设计规范](docs/设计规范.md)：设计参数与交互状态。
- [视觉验收与社区评估](docs/视觉验收与社区评估.md)：后台截图、DPI 模拟、skill 和组件边界。
- [技术决策](docs/技术决策.md)：选择、取舍与历史。
- [AI 辅助开发规范参考](docs/AI辅助开发规范参考.md)：已采用的记录方法及仍属候选的工具；执行流程见开发流程。
- [任务记录](docs/任务记录.md)：验收证据与提交。
- [数据与交付](docs/数据与交付.md)：存放、备份、更新与未来发布。
- [第三方来源](docs/第三方来源.md)：实际复用与许可证。
- [AGENTS.md](AGENTS.md)：AI 协作执行约定。

## 当前工作区

拖动标签到面板边缘分屏，到标签栏合并；拖动分隔线缩放。「窗口」菜单重新打开模块，「窗口 → 布局」可命名保存当前排列、更新或切换快照、指定或还原默认布局。再次启动会恢复最后使用的工作区，包括全部标签关闭的情况。

![深色实际渲染截图](docs/images/workbench.png)

这是后台真实 Electron 渲染的工作台预览；原生 Acrylic 随 Windows 设置和桌面背景变化。

SQLite 和媒体播放当前用于第一方Music组件。Git 只备份已提交源码与文档，私人素材、Electron 设置和被忽略数据需要单独备份。

## Windows 安装包

`npm run dist:win` 生成 `dist/FitBay-Setup-0.1.0-x64.exe`。双击启动中文安装向导，可选择安装目录（例如 D:/Apps/PersonalWorkbench）；无需安装 Node/npm。当前包未签名，不包含自动更新，安装完成不会自动启动程序。构建结果不提交 Git。

`npm run check:package` 使用独立 profile 在后台验证 dist/win-unpacked 内的真实打包程序；需先生成安装包。它不执行安装或卸载向导。更多边界见 [数据与交付](docs/数据与交付.md)。

## 独立组件原型

已实现隔离的公共宿主与 Fluent React 示例，支持系统标题栏拖入预览吸附、Dockview 标签拖出分离。运行 `npm run build:prototype` 后执行 `npm run check:prototype`，自动使用独立 profile 在后台验证；不打开日常工作区。详见 [组件开发与验证](docs/组件开发.md)。目前是分目录部署，依赖项目 Electron 运行时，不是新的独立安装包；正式应用入口和布局存储保持原状。

## 桌面双击启动

本机桌面的“FitBay”快捷方式直接打开日常工作台。双击原有的“打开个人工作台.cmd”可按数字键选择入口：

- **1 日常工作台**（5 秒后默认）。沿用 `local/desktop-profile` 和已保存布局。

- **7 Music**。可传 `--music` 独立启动，也可从工作台的「窗口 → Music」打开或激活音乐标签。默认显示「本地曲库」。点「添加文件夹」或「添加文件」索引音乐，搜索后点歌曲左侧的播放键。再次点当前歌曲可暂停或续播。底部播放器在三个页面间共用。

手动验收从项目目录运行 `scripts\open-workbench.cmd --manual`，菜单相同，布局写入 `tmp/manual-builtin-windows/profile`。每次打开验收菜单都使用这个参数。

桌面 CMD 转调项目的 `scripts/open-workbench.cmd`。工作台界面更新后运行 `npm run build`；示例或宿主更新后运行 `npm run build:prototype`。各入口使用最新的 `out/renderer`。运行 `scripts/open-workbench.cmd --check` 检查启动文件。关闭旧窗口后重开即可加载新版。

在「下载音乐」导入洛雪兼容 JS 源，手填歌名和艺人或选择曲库歌曲，查找版本、选择音质并下载到指定目录。成功后歌曲自动入库。见[洛雪音乐源](docs/组件开发.md#洛雪音乐源)。

每日推荐默认使用 DeepSeek，模型设置也支持 OpenAI、Claude 和 Gemini。详见[模型推荐](docs/组件开发.md#模型推荐)。
