## 分工与协议

Music 安装包的 `component.json` 含 `settingsEntries`。每条提供 `target`、`name`、`path`。工作台查询已安装组件的清单，展示名称和路径；打开目标时通过现有 `music-sample:state` 快照传递递增 `settingsRequest` 和 `settingsTarget`。快照握手同样可携带请求。Music 验证目标并显示对应分类，旧版无目标请求沿用上次分类。未知目标只打开设置。宿主搜索和组件安装状态处理属于工作台组。
