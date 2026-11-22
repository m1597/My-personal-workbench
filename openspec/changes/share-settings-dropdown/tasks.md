## 实现

- [x] 平台提供 Music 同源 Dropdown 和 ChoiceDropdown，设置卡片共享间距及材质；组件组迁移各自入口。ESLint 接入统一检查与 Windows CI。

## 实测

- [x] 从实际开发入口展开连接与协议并保存截图。
- [ ] 组件组在独立入口复验其迁移的下拉菜单。

当前平台分支的提示词库与工具集各有五处旧原生控件。ESLint 按文件记录存量数量，新增超额用法会失败；组件组迁移后集成时用 `eslint --prune-suppressions src/renderer components` 清理基线。
