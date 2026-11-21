# FitBay 截图与划词工具集

## 入口与数据

在工作台的「组件」菜单选择「截图与划词工具集」。停靠面板可以框选屏幕、打开设置。开发版可单独双击 `scripts/open-toolkit.cmd`，打包版通过「FitBay 工具集」快捷方式启动。窗口关闭后，快捷键继续工作；在系统托盘菜单退出可释放全部绑定。默认选区限于鼠标所在显示器。

分别在「屏幕截图」和「划词助手」输入组合键并应用。截图时拖动框选，选择复制、保存或贴图置顶；Esc 取消。PDF 须包含可选文字，选中后按划词快捷键。扫描件可走截图翻译。复制取词检查前台窗口和剪贴板更新来源，未读到新选区时给出提示。

组件设置与工作台「全局设置 → API 与模型」读写同一绑定。翻译与文字问答、视觉问答可单独配置，或显式复用某个已有连接。可填 Chat Completions、Responses、Claude Messages 或 Gemini generateContent 的 API 基址与模型名。远端使用 HTTPS，本机服务也接受 HTTP 和空密钥。视觉模型需支持图片。密钥通过 Windows 当前用户 DPAPI 加密后存入公共 profile 的 api-connections.sqlite；旧版 toolkit/settings.json 中的受保护密钥在原工具集用户目录解密、重新加密。迁移失败会保留原文件，允许逐项更换。普通复制、保存、贴图都在本机完成。截图翻译使用 Windows OCR，将识别文字发给模型。视觉提问发送裁剪后的 PNG。结果窗口可复制最新回答、置顶、输入后追问；关闭窗口清除会话。

自定义动作来自提示词仓库 v1 的 listActions 和 resolveAction，每次执行重新读取模板。文字动作可消费划词或截图 OCR，图片动作消费选区原图。[仓库组接口](../../openspec/changes/pin-prompt-actions/interface.md)

## 2026-11-21 共享 API 配置验收

独立工具与工作台分别打开设置页。工作台先启动时导入原工具集的加密密钥和两个用途，原快捷键与停用状态保持一致。使用随机测试凭据校验跨进程解密、磁盘不含明文和密码框遮盖。两个打开的窗口双向修改模型后均自动刷新；显式复用后两个用途指向同一连接，改回单独配置后各自保存。损坏旧密钥能够分用途修复，过期表单不能写入改绑后的其他连接。

在空配置下从桌面打开截图、复制及贴图。点击截图翻译时出现直达对应设置的按钮。[320 像素设置页](../../tmp/toolkit-connections-z6gznH/settings-320.png)和[680 像素设置页](../../tmp/toolkit-connections-z6gznH/settings-680.png)使用合成的长地址；已检查标签、输入框、保存按钮的对齐及窗口边界，长地址在输入框内滚动。复现运行 `node scripts/check-toolkit-connections.mjs`。加 `--packaged` 可从独立的 FitBay Toolkit.exe 重跑同一套验收，已实测通过。

本机回环接口分别收到了文字模型和视觉模型各自的请求路径与模型名。Chrome PDF 划词的翻译与解释、OCR 翻译仅发送文字，图像动作和自由视觉问答收到 PNG，追问沿用同一用途。[PDF 阅读器](../../tmp/toolkit-2vVGsq/pdf-selection.png)、[置顶贴图](../../tmp/toolkit-2vVGsq/pin.png)、[视觉追问](../../tmp/toolkit-2vVGsq/answer.png)。HTTP 503 后在原窗口重试成功；协议检查覆盖 Chat、Responses、Claude、Gemini 及 401、415 和 60 秒超时。真实服务由用户随后自行验证，本轮未调用。

## 本地验证

在 Windows 独立 profile 执行 `node scripts/check-toolkit.mjs --pdf --host --absent`。PDF 测试另用本机 Chrome、Python 与 pywinauto。缺席场景要求当前用户未登记 Prompts 产品，使用 `node scripts/build-installers.mjs --toolkit` 构建的独立可执行文件。脚本打印每次生成的 tmp 证据目录。

| 场景             | 验收边界                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| 工作台与仓库并存 | 先在组件菜单实际打开提示词仓库，再打开工具集停靠面板。面板可唤起正在运行的独立实例框选，动作列表含「解释推导」。 |
| 仓库缺席         | 独立打包运行时读取带有旧动作的隔离 profile；无仓库安装登记时隐藏旧动作，框选仍可使用。                           |
| 本地截图         | 在真实桌面框选合成样张，确认 PNG 落盘、贴图为置顶窗口，模型接口请求数保持零。自动保存用例代选文件路径。          |
| PDF 划词         | 在 Chrome PDF 阅读器选择 HELLO FITBAY 123，经 Windows 全局快捷键捕获相同文字，翻译按钮向本机测试接口提交文本。   |
| OCR 和视觉问答   | Windows OCR 识别样张；截图翻译请求仅含文本。修改已固定的图像提示词后重新框选，测试接口收到新模板及选区 PNG。     |
| 模型错误恢复     | 测试服务返回 503，保留选区；在结果窗再次运行动作成功。追问带入上次回答，结果可以固定。                           |
| 快捷键及窄窗     | 尝试将截图设为划词占用的键，看到冲突且原键仍注册。320 像素宽设置页无横向溢出。                                   |

测试服务采用本机 HTTP 回环，测试返回值仅供核对请求结构、重试及窗口行为。真实模型服务的识图质量、翻译质量和服务端鉴权仍待验。没有在日常 Windows 账户执行安装或卸载。尚未进行双显示器混合 DPI 设备验证。远程 CI 及版本发布均未执行。

桌面回归核对了截图复制与结果复制交给 Electron 剪贴板的内容；测试中替换最后的剪贴板写入调用，保留用户原有剪贴板。另运行 `node scripts/check-toolkit-api.mjs`，验证带鉴权头的根地址请求、HTTP 401、415 以及真实等待 60 秒后的超时。PDF 无选区时未发送请求。独立助手与工作台均使用隔离 profile。

本机运行证据：[窄窗设置](../../tmp/toolkit-8xQM16/home-narrow.png)、[置顶贴图](../../tmp/toolkit-8xQM16/pin.png)、[PDF 划词](../../tmp/toolkit-8xQM16/pdf-selection.png)、[视觉追问](../../tmp/toolkit-8xQM16/answer.png)、[两组件共存](../../tmp/toolkit-8xQM16/workbench.png)。截图使用合成页面和测试回答。运行脚本会在新的临时目录生成同类证据。

最终构建通过 npm run check（生产与开发各 16 项）、原型重建、桌面脚本入口检查和 OpenSpec 严格校验（41 项）。四项本地功能的 OpenSpec 已归档。[模型问答](../../openspec/changes/add-selection-model/tasks.md) 保留真实服务待验项。开发安装包 SHA-256 为 `E17C0B23BDF00534CA288A70D994783D666BF2A42DF85017271063F705E74AA8`。

## 来源与许可

| 项目                                         | 本轮用途和许可核对                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron 45.2.3                              | 使用仓库锁定运行时的 desktopCapturer、nativeImage、globalShortcut、safeStorage 和窗口接口。MIT；包内保留 LICENSE.electron.txt 和 LICENSES.chromium.html。[截图接口](https://www.electronjs.org/docs/latest/api/desktop-capturer) |
| koffi 3.3.7、@koromix/koffi-win32-x64 3.3.7  | 使用已有锁定依赖查询前台 HWND 和安装登记；两包元数据为 MIT，随包保留 koffi/LICENSE.txt。                                                                                                                                         |
| Windows PowerShell、WinRT OCR、Windows Forms | 使用系统已安装的组件，本包不再分发 Windows 功能或语言包。                                                                                                                                                                        |
| electron-builder 26.18.0、Playwright 1.65.0  | 分别用于构建与开发测试；锁定版本许可为 MIT 与 Apache-2.0，未列入工具集运行时依赖。                                                                                                                                               |
| Snipaste                                     | 参考框选后的按钮与可移动置顶贴图交互。未分发其软件、图标或资源。[交互文档](https://docs.snipaste.com/)                                                                                                                           |
| STranslate                                   | 核对上游 WPF 实现和 MIT 许可。首版使用现有 Electron 与 Windows OCR，未移植源码、插件或模型。[上游仓库和许可](https://github.com/STranslate/STranslate)                                                                           |

安全复核后改用已有安装目录校验和按包文件清单卸载逻辑，安装登记使用 Unicode 接口。启动注册失败按实际绑定显示状态；更换键后配置写入失败会恢复旧绑定。未接入 n8n。
