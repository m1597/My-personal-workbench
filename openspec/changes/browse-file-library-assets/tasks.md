## 实现与验收

- [x] 目录保留层级和各目录视图，空格预览图片，同名 TXT 可打开；按默认当前目录或所有常用位置搜索，MD/TXT 可匹配正文。

独立与停靠窗口均已打开。旧设置、目录视图、范围切换、MD/TXT 正文、同名 TXT、复制和图片预览通过。只读打开现有 Serpent Assets / 图片素材，保持上下级目录，在 380 DIP 窄窗展开位置导航。[独立窄窗](../../../tmp/file-library-P3wyh9/narrow-locations.png) · [停靠文件列表](../../../tmp/file-library-P3wyh9/docked-files.png)。

## 工具集交接

文件库与工具集开发版本均为 0.1.0，读取协议 v1，组件标识 io.fitbay.prompts。可从独立或停靠的文件库选中解释推导.md，展开「固定为工具集动作」，选择图片输入。工具集截图后选择「解释推导」，预期每次提交都按同一动作 UUID 重新读取模板并附带截图 PNG；文件失效返回 FILE_UNAVAILABLE，缺少组件返回 COMPONENT_ABSENT。本轮复验清单、错误和运行时重读；两次截图的实际请求证据见[动作联测记录](../pin-prompt-actions/tasks.md)。

本轮开发提交 `1dc9b41`（退出清理）、`46e19a9`（目录同步）、`29f4380`（组件入口与交互）。在后者的独立检出构建 0.1.0 x64 开发包，以包内 FitBay Prompts.exe 启动空 profile，验证打开本地目录、预览图片并展开同名 TXT。[独立程序记录](../../../tmp/file-library-exe-pBZ2ak/verification.json)。包标识、二进制名及 profile 路径沿用旧版。

供集成验收复用的开发样本 `tmp/prompts-YJuz3K/profile` 内，图片动作 UUID 为 `6f358d37-9003-4dfe-b1a8-340e90dd3998`。工具集与文件库需指向同一隔离 profile。通过正常的仓库固定入口重建样本时会得到新的 UUID，以清单回传值为准。本轮验证由文件库解析到新版模板；实际两次截图请求证据来自前一轮。全局快捷插入本轮使用独立 Windows 输入框，测试结束已核对恢复原前台窗口。

在 29f4380 的干净检出检查格式、lint、类型、构建和 doctor。生产模式 16 项最终通过（一次 Electron 启动失败后单测重跑）；开发模式 16 项最终通过，其中两项需重试。共享工作区的 npm run check 遇到其他在途文件的格式差异。真实 open-prompts.cmd --verify 标题为文件库，open-workbench.cmd --check 通过。未执行远程 CI、全新系统安装卸载或物理热拔插。
