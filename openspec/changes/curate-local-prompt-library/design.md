## Context

文件库已有磁盘监听、目录权限核对、Markdown 安全渲染、动作清单、全局面板和组件共享设置。

## Decisions

组件组维护组件清单、专用 preload、数据读取和界面。平台侧沿用注册 ID 更新工作台目录、安装管理与窗口显示名。首次选择使用新的偏好字段，保留旧字段和磁盘文件。Skill 以含 SKILL.md 的目录为一条记录，其资源沿用原路径。模板采用 {{变量名}}，未填值逐字保留。AI 结果先显示可取消的预览，确认后保存独立文件，保留来源。

Skill 的识别与目录边界参照 [Agent Skills 格式规范](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)。收录 SKILL.md 时保留整个来源目录，附属资源不单独生成卡片。
