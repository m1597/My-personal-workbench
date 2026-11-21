## 组件公共设置与任务栏验收

平台公共接口由 bcb75ab 提供，Music、组件菜单和工具窗口归属由 dcd7eb2 接入。文件库与工具集分别维护业务分类、表单与主视图状态，使用同一份齿轮和分类布局。React 通过 ComponentSettings 绑定，工具集 DOM 入口调用 createSettingsGear 和 createSettingsShell。独立工具集沿用组件任务栏入口；宿主启动参数 --fitbay-hosted 随窗口操作传给截图、结果与贴图。已有独立结果窗保留原归属。

- 真实安装版运行时加本轮产品资源，在同一隔离配置打开三个组件，检查四格布局和三个菜单项的图标、名称、状态、操作横坐标。各列逐行一致。[组件菜单](../images/shared-settings/component-menu.png)
- 三个组件均从停靠和独立窗口进入公共设置并返回。Music 从搜索结果进入播放设置，返回后保留查询，再入仍定位播放分类。[分屏设置](../images/shared-settings/music-docked-settings.png) · [独立设置](../images/shared-settings/music-standalone-settings.png)
- Windows Explorer 任务列表对照：独立启动时检测到工具集入口，再由宿主打开设置和截图，两个阶段均只检测到 FitBay 的工作台应用标识。后台测试窗口未移动用户鼠标。系统已有工作台窗口参与了任务栏分组。
- 复验命令为 node scripts/check-installed-settings-shell.mjs 加安装目录的绝对路径。截图操作的像素和剪贴板内容由工具集组及集成验收组独立复验。本轮未发布。
