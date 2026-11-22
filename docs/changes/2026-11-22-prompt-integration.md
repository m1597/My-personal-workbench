# 提示词库快捷键集成复验

2026-11-22 从桌面 FitBay.cmd 指向的开发目录核验。原位升级 d5798c3，快捷键接入 1817db4，现场工作区 HEAD 61878a9，有并行修改。桌面入口检查通过。实际 prompts/component.js 的 SHA-256 为 5292F80CFA880D14C8311F4A9D8BE6BBEBB53FCCFBB2775ECF47FCE8B4AAE7ED，与交接一致。

使用隔离 profile 和不可获焦的后台宿主。独立窗口从禁用 F9 开始，录制 F8 后保持禁用，启用后 Electron 确认已注册。Esc 取消保留 F8。改为 Ctrl+Alt+Shift+F7 后尝试已占用的 F6，页面提示占用，原组合仍注册。禁用后单项恢复默认，从停靠设置修改再恢复组件全部，重启保持禁用且默认键未注册。再次启用 F8，重启确认已注册。从工作台设置搜索进入「提示词库 › 全局快捷键」读取到相同状态。三个分类逐个切换，选中项唯一，焦点进入内容区具体控件。原位升级专项亦通过。[工作台搜索入口截图](../../tmp/prompt-shortcuts-6AuS37/workbench-settings.png) · [停靠设置](../../tmp/prompt-shortcuts-6AuS37/docked.png) · [原位升级回归](../../tmp/prompt-cards-AKZdYz/docked.png)

另从工作台搜索入口以已启用 F8 测试单项恢复。现场直接尝试注册默认组合 Control+Alt+Shift+P 返回 false；页面报告占用，仍保留 F8、启用状态及实际注册，与冲突处理预期一致。补充探针预设恢复成功的断言因此未通过。默认组合可用时，启用状态下两种恢复的成功路径仍待验。无需更改用户快捷键。[补充探针](../../tmp/integration-prompt-reset-enabled.mjs)

本轮限于开发构建后台专项。全仓检查沿用实现组交接状态，远程 CI、发行包及用户前台按键体验未验。
