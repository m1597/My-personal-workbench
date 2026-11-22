## 实现与验收

- [x] 在已选择目录通过首页「粘贴导入」保存 UTF-8 文本；拖入多个 TXT/MD 时逐个保存并收录。已有同名文件保留，新增文件使用编号名称。
- [x] 只读 Skill 目录保留相对引用。单独拖入的 SKILL.md 作为普通 Markdown 保存为 SKILL（导入）.md，避免目标目录整体被识别为 Skill。
- [x] 在「设置 → 目录」开启导入后自动可视化。模型失败保留原文并继续下一文件，外部删除后卡片自动消失。

宿主接口 `importText(root,name,text)` 只接受当前选定目录与符合规则的非空文件内容，4 MiB 上限，返回实际新文件名。`autoVisual(enabled)` 保存导入偏好，默认关闭。已有目录、原文件与编辑冲突机制沿用本地组件服务。

实测通过 `node scripts/check-prompt-visuals.mjs`，在独立入口粘贴开发样本，停靠时拖入 3D TXT 和 SKILL.md。另一次拖入两份不匹配模型引用的文件，两份原文均落盘且均未缓存无效结构。相关入口、证据和依赖见[可视化验收](../visualize-local-prompts/tasks.md)。
