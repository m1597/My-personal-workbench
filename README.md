# 个人工作台

本地优先的个人创作工作台。目前实现四个可拖拽、停靠、分组、缩放、关闭重开的占位模块，以及最大化、恢复布局与黑白主题切换。

技术栈：Electron + React + TypeScript + Vite，Dockview 布局。视觉为微软 Fluent 磨砂玻璃，默认深色；中文优先本机 HarmonyOS Sans SC，回退微软雅黑 UI。记住主题选择和上次布局；首次启动使用默认四模块，全部关闭的空工作区也会保留。

## 组件产品方向（已确认目标，架构待确认）

工作台与音乐/资产等组件分别安装，组件可独立启动，也可接入工作台停靠与分离。当前版本尚未实现组件宿主或第三方接入；音乐库暂停，先审阅 [组件框架设计](docs/组件框架设计.md) 并确认方案，再做示例原型。

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
| npm run check                 | 环境、格式、静态、类型、构建、26 项交互及 doctor 回归的统一入口 |

统一检查只执行一次类型检查和生产构建。失败从终端首个错误看起，报告打开方法见开发流程。2026-11-09 已按用户授权推送，[首次 Windows CI](https://github.com/m1597/My-personal-workbench/actions/runs/42599390733) 已通过（提交 8af4c32，含 10 项交互测试）。

## 文档入口

- [需求与规划](docs/需求与规划.md)：已确认、候选与待办。
- [架构说明](docs/架构说明.md)：目录、调用关系与权限边界。
- [开发流程](docs/开发流程.md)：环境、验证和提交步骤。
- [设计规范](docs/设计规范.md)：设计参数与交互状态。
- [视觉验收与社区评估](docs/视觉验收与社区评估.md)：后台截图、DPI 模拟、skill 和组件边界。
- [技术决策](docs/技术决策.md)：选择、取舍与历史。
- [任务记录](docs/任务记录.md)：验收证据与提交。
- [数据与交付](docs/数据与交付.md)：存放、备份、更新与未来发布。
- [第三方来源](docs/第三方来源.md)：实际复用与许可证。
- [AGENTS.md](AGENTS.md)：AI 协作执行约定。

## 当前工作区

拖动标签到面板边缘分屏，到标签栏合并；拖动分隔线缩放。「窗口」菜单重新打开模块，「重置布局」恢复初始排列。右上角太阳/月亮切换主题。

![深色实际渲染截图](docs/images/workbench.png)

[浅色截图](docs/images/workbench-light.png)。这是后台真实 Electron 渲染；原生 Acrylic 随 Windows 设置和桌面背景变化。

当前不实现数据库、AI 执行、媒体处理、插件 SDK 或第三方软件嵌入。Git 只备份已提交源码与文档，私人素材、Electron 设置和被忽略数据需要单独备份。

## Windows 安装包

`npm run dist:win` 生成 `dist/Personal-Workbench-Setup-0.1.0-x64.exe`。双击启动中文安装向导，可选择安装目录（例如 D:/Apps/PersonalWorkbench）；无需安装 Node/npm。当前包未签名，不包含自动更新，安装完成不会自动启动程序。构建结果不提交 Git。

`npm run check:package` 使用独立 profile 在后台验证 dist/win-unpacked 内的真实打包程序；需先生成安装包。它不执行安装或卸载向导。更多边界见 [数据与交付](docs/数据与交付.md)。
