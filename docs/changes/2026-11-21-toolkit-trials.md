# 工具集桌面验收与交接 · 2026-11-21

独立入口为工具集可执行文件或 `scripts/open-toolkit.cmd`。停靠入口为工作台「组件 → 工具集」。首次打开即可截图、复制和贴图；框选后出现选区工具栏。两处共用工具视图。停靠中的文件和文本操作留在面板内，截图和测量打开原生浮层。[独立首页](../images/toolkit-trials/home.png) · [工作台停靠](../images/toolkit-trials/host.png) · [窄窗](../images/toolkit-trials/narrow.png) · [选区工具栏](../images/toolkit-trials/toolbar-20.png)

| 从首页操作     | 两种入口的实测结果                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| 截图标注       | 实际桌面框选，进入标注并应用，回到可贴图的选区工具栏。                                                 |
| 屏幕测距与取色 | 两点距离与原始显示像素计算相符，复制的十六进制颜色与截图像素一致。                                     |
| 两图对比       | 两张图片可切换，滑块设为 35% 时读回上层透明度 0.35。[双图界面](../images/toolkit-trials/compare.png)   |
| 多图拼接       | 调整顺序，分别导出长 PNG 和 PDF，回读尺寸、颜色及 PDF 页序。                                           |
| 图片压缩       | 对噪声样图指定大小，读回 JPEG 核对字节上限，原图保留。                                                 |
| 剪贴板处理     | 纯文本、带粗体的 Markdown、提示词 .md、图片 PNG 均走按钮。提示词按用户选择的位置落盘，可选文件库目录。 |
| 逐行文本对比   | 直接输入或选择两个文本文件，分别核对插入行、删除行。                                                   |
| 配对重命名     | 同名自动配对、不同名手动配对均可确认。已有同名目标会禁用确认，换前缀后成功，读回冲突文件内容未变。     |
| 批量格式转换   | WebP 转 PNG、实际调用本机 Word 将 DOCX 转 PDF；回读图片及 PDF 正文。                                   |

## 隔离复测

运行 `node scripts/check-toolkit-trials.mjs --packaged`（需先构建工具集）和 `node scripts/check-toolkit-trials.mjs --host`（先构建工作台）。脚本使用独立 profile、样图和文档，记录输入与输出目录。文件选择对话框和剪贴板使用可控样本，导出和读取使用实际文件系统。按输入类型及数量过滤动作，原始图片、压缩目标、输出重名和配对冲突均可复验。

- **宿主与快捷键。** 选择「组件 → 工具集」，选择两张图进入对比；从同一面板启动框选应出现原生选区。占用截图快捷键后，组件设置显示冲突，仍可点「框选屏幕」。真实 Chrome PDF 已使用系统划词快捷键取得选中文字，经本地测试服务得到译文；空选区给出反馈。
- **共享设置。** 用隔离 profile 运行 `node scripts/check-toolkit-connections.mjs`。从组件设置编辑翻译连接，再到工作台「全局设置 → API 与模型」核对；反向改视觉连接，核对组件显示。显式复用、独立绑定、旧加密配置迁移、损坏凭据替换及过期写入拒绝均已覆盖。密钥默认遮盖。[320 设置页](../images/toolkit-trials/settings-320.png) · [680 设置页](../images/toolkit-trials/settings-680.png)
- **提示词仓库。** 运行 `node scripts/check-toolkit.mjs --host --absent`。仓库在场时以样图运行注册动作，核对视觉请求包含 PNG、503 后重试和追问；OCR 翻译只交文字。移除仓库的隔离环境仍能截图，失效动作消失。OCR 和贴图回归使用受控截图样张；上表测距、标注使用实际桌面捕获。
- **图标。** 检查九项动作在 [16](../images/toolkit-trials/icons-16.png)、[20](../images/toolkit-trials/icons-20.png)、[24](../images/toolkit-trials/icons-24.png) px 的辨识度。打包后的 [EXE](../images/toolkit-trials/exe-icon.png)、[窗口 WM_GETICON](../images/toolkit-trials/window-icon.png)、[Windows 快捷方式](../images/toolkit-trials/shortcut-icon.png) 均读回工具箱。Explorer 现有固定项缓存及实际任务栏合成画面待验。

## 依赖与边界

沿用现有 Electron 和 Koffi，许可及随包声明见[原核查](2026-11-20-desktop-toolkit.md)。图标和工具逻辑在项目内实现。图像和 PDF 使用现有运行时，本次未增加 npm 依赖。Word 与 LibreOffice 调用用户已安装的程序。接口依据为 [Electron nativeImage](https://www.electronjs.org/docs/latest/api/native-image)、[Electron printToPDF](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)、[Word PDF 导出](https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat)及 [LibreOffice 启动参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)。

真实供应商 API 由用户另验，本轮文字和视觉响应为本地测试服务。LibreOffice 后备转换、本机以外的多显示器混合 DPI、用户原有固定快捷方式、安装升级及远程 CI 待验。本轮为本地开发构建。
