## 实现

- [x] 复用正式发行资产检查与流式 SHA-256，限制 IPC 和安装并发。
- [x] 在组件管理列出安装状态、进度、重试和实际版本，支持宿主目录及注册表发现。

## 验收

- [x] 从隔离安装版入口检查三组件、校验失败重试、安装后检测和重启发现。
- [x] 单独记录真实发行服务联通及 SHA-256，执行严格校验和项目回归。

### 安装版后台验收（2026-11-21）

- 桌面「FitBay 工作台」快捷方式指向 D:\FitBay\FitBay.exe。使用相同 EXE 的隔离副本、当前构建的应用资源及独立 profile，在后台从齿轮进入组件管理。命令为设置 FITBAY_TEST_INSTALLED_RUNTIME 指向该安装目录后运行 `node scripts/check-component-installation.mjs`。
- 测试发行数据使用只写入临时目录的 NSIS 安装器。初始三行都可安装，只有清单而缺 EXE 的工具集登记不算已安装。Music 下载显示百分比，第一次传入等长损坏字节后显示 SHA-256 失败，点击重试成功。文件库首次安装成功。工具集首次落盘旧版本后显示检测失败，重试正确版本成功。
- 安装后界面三行均显示 0.2.0，Music 运行设置可操作。重启后通过工作台目录的 Music、Prompts 和 Toolkit 子目录重新发现三项，无需注册表。截图在本机 `tmp/component-setup-HbbSOY/retry.png`、`installed.png`。既有安装版更新页回归也通过。
- 真实发行服务单独验证。GitHub API 返回官方仓库 v0.2.0，三个 x64 EXE 完整下载并核对大小、SHA-256 与包内产品标识、版本。Music 127243894 字节，摘要 `14ba4efa377063cb757dcd475c5a650f3aacd243558458de1457d0d11189a4c5`；Prompts 122214510 字节，摘要 `753074659fc0b0723c58a37e8af76cfccd8cf0a1156ec0c37a472235d90090c3`；Toolkit 121957613 字节，摘要 `c841fe5eddaaa384cd976520ed2072633a64a0a7a0b9f7612c7be04e8826725a`。
- 严格 OpenSpec、产品更新单测、类型检查、原型构建、lint、doctor 测试、桌面入口脚本 --check 和宿主界面回归分别执行。全仓 npm run check 在格式阶段被本次提交以外的六个文件阻断，详见 tmp/component-setup-format.log。
- 待发行组用最终候选包验证正式安装器落盘与系统登记，再由主对话安排用户重装。远程 CI 和用户实际重装待验。
