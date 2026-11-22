## 验收

- [x] 双入口录制功能键和组合键，取消与冲突保留原值。
- [x] 单项及组件恢复，保留启停，重启核验。
- [x] 分类选中态、具体控件焦点和桌面入口构建。

## 集成交接

原位升级基础提交 d5798c3，本次组件提交主题为「接入平台快捷键录制并持久化提示词库启停」。依赖平台组 src/renderer/src/app/ShortcutRecorder.tsx 和 recordShortcut.ts，本次联测使用同一工作区的平台实现。桌面 D:/Desktop/FitBay.cmd 调用本仓库 scripts/open-workbench.cmd --workbench。使用同一 out/renderer 与 dist/component-prototype，在独立 profile 后台启动。

- 独立窗口录制 F8 和 Ctrl+Alt+Shift+F7。Esc 取消保留原值，宿主预占 F6 后保存冲突，原组合仍在 Electron 全局注册表中。
- 禁用后分别单项和组件恢复默认，重启仍禁用且未注册。启用 F8 后再次重启，确认实际重新注册 F8。
- 工作台设置搜索「全局快捷键」进入「提示词库 › 全局快捷键」，读到相同 F8 和启用状态。逐一切换三个分类，仅一项 aria-pressed，活动元素位于当前分类的具体控件。
- 快捷键证据 tmp/prompt-shortcuts-LNQWgY，原位升级回归 tmp/prompt-cards-OC9h9T。复验命令为 node scripts/check-prompt-shortcuts.mjs 和 node scripts/check-prompt-catalogue.mjs。
- 实测构建的 prompts/component.js SHA256 为 5292F80CFA880D14C8311F4A9D8BE6BBEBB53FCCFBB2775ECF47FCE8B4AAE7ED。build:app 与 build-component-prototype.mjs 分别执行成功，open-workbench.cmd --check 通过。全仓 check 遇到其他在途文件格式差异；单跑类型检查遇到 tests/edge-collapse.spec.ts:10 的空值错误。未跑远程 CI 或发行包验收。
