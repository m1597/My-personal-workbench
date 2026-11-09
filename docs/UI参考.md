# UI 参考与实现边界

用户选定 Penpot 深色工作区作为主要视觉参考，Dockview 作为面板布局库。

## 来源

- [Penpot 官方工作区导览](https://help.penpot.app/user-guide/first-steps/the-interface/)
- [Penpot 官方界面截图](https://help.penpot.app/img/interface/workspace-dark.webp)
- [Penpot 公开颜色定义](https://github.com/penpot/penpot/blob/develop/frontend/resources/styles/common/refactor/color-defs.scss)
- [Dockview](https://github.com/dockview/dockview)：使用 MIT 开源包，不使用 Enterprise 扩展。
- [Lucide](https://lucide.dev/)：使用 lucide-react 社区图标。

## 设计约定

- 基础背景 #18181a，控件背景 #232326，分隔线 #343438，主要文字 #f4f4f5，次要文字 #a1a1aa，强调色 #8ce8d9。
- 字体使用 Segoe UI 与 Microsoft YaHei UI，中文优先保证本机清晰显示；控件 12–13px，模块标题 13px。
- 顶部为工作台菜单、项目名与布局操作；左侧为模块导航；面板支持标签拖拽停靠和分隔线缩放。
- 中央面板使用浅灰画布，对照 Penpot 的深色工具区与浅色画布；占位内容不伪装成已经实现的编辑器。
- 不增加装饰性大卡片、渐变或持续动画；拖拽期间避免过渡动画干扰反馈。
- 本项目未复制 Penpot 应用源码、商标或图标；参考界面样式，使用 React 编写适合工作台的组件。官方截图仅作为研究资料，不作为产品资源发布。

## 字体调整

中文优先使用本机已安装的 HarmonyOS Sans SC（鸿蒙黑体），回退到微软雅黑 UI。正文 13–14px，辅助文字至少 12px；不打包或分发系统字体。已通过 Chromium 字体检查确认中文标题实际使用 HarmonyOS Sans SC。
