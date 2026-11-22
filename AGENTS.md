# FitBay 协作入口

- 用简体中文。先查 `git status`，保护未提交成果，按已确认范围工作。了解项目看 [README](README.md) 和 [需求与规划](docs/需求与规划.md)。
- 项目规范负责协调。派工或集成时读 [派工约定](docs/teams/coordination/AGENTS.md)，用户确认后再发送绝对目录和分支。
- 开发组先用 `git rev-parse --show-toplevel` 和 `git branch --show-current` 核对派工，在指定 worktree 编辑、构建、自测。按职责只读本组约定：[平台](docs/teams/platform/AGENTS.md)、[Music](docs/teams/music/AGENTS.md)、[工具集](docs/teams/toolkit/AGENTS.md)、[提示词库](docs/teams/prompts/AGENTS.md)、[验收](docs/teams/acceptance/AGENTS.md)、[打包](docs/teams/packaging/AGENTS.md)。
- 小修记任务，重要变更走 OpenSpec，重大架构先确认并记 ADR。涉及上游依赖、界面、宿主接口、修复或代码交付时，按章节查 [开发约定](docs/teams/implementation/AGENTS.md)。界面沿用 Music；测试优先隔离后台；纯文档核对链接、格式和事实。
- 默认分支 `main`，长期组分支 `team/<组>`，其他新任务用 `codex/`。只提交本事项；禁止破坏性 Git 操作，未经授权不推送、不改全局 Git 配置、远程设置或云权限。
