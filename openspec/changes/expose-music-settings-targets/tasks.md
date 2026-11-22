## 实现

- [x] Music 清单公布设置条目，组件处理合法目标、旧调用及未知目标。

- [x] 移除设置分类内容容器的焦点边框，保留侧栏选中、搜索定位和控件焦点。

## 验证

- [x] 私有桌面静音 Electron 验证九个分类、歌词区域获得焦点、快捷键控件、旧调用、未知目标及重复快照。截图见 `tmp/music-settings-targets-oPvo5G/lyrics.png`。
- [x] 单项及全库严格校验通过。工作台搜索结果点击跟踪于 `search-installed-component-settings`。
- [x] 桌面仓库构建后运行 scripts/check-music-category-focus.mjs，独立窗口与工作台组件菜单停靠入口通过；截图在 tmp/music-category-focus-bncpVe/。搜索直达回归通过，见 tmp/music-settings-targets-kBXLPg/。
