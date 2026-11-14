# 设计

Dockview 与播放器在设置打开期间保持挂载。原生子视图临时隐藏，返回后由原插槽恢复边界。布局切换按快照逐个恢复组件，没有插槽的停靠组件转入后台。工作台通过专用 IPC 读取经过清单校验的组件版本，音乐设置请求由播放器自己的页面处理。

保留现有布局及六项偏好的存储键。新增独立启动策略，旧配置按上次工作区恢复。Lobster 字体随包分发并附原始 OFL 许可证。

分类搜索和设置范围参考 [VS Code 设置](https://code.visualstudio.com/docs/configure/settings)。分屏指令放入一级布局菜单，依据 [VS Code 布局](https://code.visualstudio.com/docs/configure/custom-layout)。窄窗口先收起非操作性布局名，参考 [Microsoft CommandBar](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/command-bar)。组件动作根据检测结果启用，参照 [PowerToys 模块页](https://github.com/microsoft/PowerToys/blob/main/src/settings-ui/Settings.UI/SettingsXAML/Views/AlwaysOnTopPage.xaml)。字标使用 [Google Fonts 的 Lobster 原版](https://github.com/google/fonts/tree/main/ofl/lobster)。
