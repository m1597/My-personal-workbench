# 工具集截图、划词与取色验收

工作树为 `D:/Desktop/Projects/FitBay/teams/toolkit`，分支为 `team/toolkit`。功能提交依次为 `3c14713`（取色结果）、`1ac2fbb`（统一问 AI）、`c300ac7`（原位翻译），快捷键回归为 `88b2821`。三个功能分别归档在 OpenSpec 的 toolkit-runtime 规范。本轮桌面 CMD 指向 `D:/Desktop/Projects/FitBay/workbench/scripts/open-workbench.cmd`，组内验收使用本组构建的对应宿主和独立程序，公共开发版由集成负责人更新。

## 从桌面入口复验

| 入口                     | 操作与观察                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 组件 → 工具集 → 框选屏幕 | 连续截图两次，独立窗口和系统快捷键重复同样步骤。三个入口均能粘贴原选区的红绿两色，按 Esc 后遮罩关闭并立即再次框选。停靠入口铅笔折线、跨窗粘贴与系统另存为 PNG 逐像素一致。                                                         |
| 选区 → 翻译              | 取本机 GnuTLS 手册的 PKCS #11 多分支图，含小字号、交叉箭头及重复标签。两个入口各识别出 16 个文字块。本地 OCR 用系统语言包读取坐标和角度；分别选择原图、仅中文、双语，放大至 8 倍并查看完整长译文。模拟响应缺块后从原窗口重试成功。 |
| 翻译后追问、选区 → 问 AI | 翻译接口仅收到编号及识别文本，追问继续只发文字。重新框选后点「问 AI」默认解释，视觉接口收到的 PNG 与选区编码逐字节相同；连续两次追问保留首次图片及前文。自由输入也能提交新问题。                                                   |
| Chrome PDF → 划词快捷键  | 从实际 Chrome PDF 阅读器获取选中文字。翻译和默认解释调用文字用途；连续追问两次保留纯文本上下文。取消选区后有明确反馈，测试接口请求数保持不变。已有提示词动作能处理原始 PNG，模拟 503 后原窗口可重试、固定和追问。                  |
| 屏幕取色                 | 独立首页、停靠首页与系统取色快捷键均打开可见结果窗，显示色块、HEX 和 RGB；复制两种格式、重新取色、Esc 返回均已实测。                                                                                                               |
| 齿轮 → 快捷键            | F1 受本机其他程序占用，启用状态尝试保存显示冲突并保留原注册。停用的划词助手可录制并保存 F1，重启读回 F1。F2 实际注册成功。取消录制、冲突保旧、恢复单项、全部恢复和两次重启保留启停状态通过。                                       |

[铅笔粘贴结果](../images/toolkit-assistants/annotated-paste.png) · [取色结果窗](../images/toolkit-assistants/color-result.png) · [已有窄窗及连接来源证据](2026-11-22-toolkit-choices.md) · [托盘、任务栏与材质](2026-11-22-toolkit-runtime.md)

停靠流程图样张位于本机 `tmp/toolkit-diagram-NPm6XH`，独立程序样张位于 `tmp/toolkit-diagram-j70RMd`，含原图、仅中文、双语、缩放截图及 OCR 输出。原图层与实际捕获 PNG 像素完全一致。停靠样张的 2,517 个蓝色箭头及连线像素全部保持原值，独立样张为 2,622 个；两种译图在文字包围区外的像素差均为 0。测量只覆盖所测样图。系统 OCR 对贴近箭头的编号有漏认首字母的情况，译图保留原图切换。译文使用回环测试服务的固定响应，未验证真实服务的翻译质量。

## 集成与打包

- 先包含平台共享选择器与默认连接提交 `8ee47c6`、`534bab5`，再集成工具集分支。配置沿用既有系统保护的凭据库。独立与宿主编辑、旧配置迁移、凭据遮盖、损坏恢复和过期并发写入拒绝已在隔离配置验证。
- 独立启动入口为 `FitBay Toolkit.exe`，资源入口为 `resources/app/main.mjs`。核对 `resources/app/{view.js,preload.cjs,image-translation.mjs,translated-diagram.js,ocr.ps1,model.mjs,recorder.js,tokens.css,toolkit.ico}`、连接模块与 `resources/app/node_modules/koffi`。继续使用现有 Electron、koffi、Windows PowerShell/WinRT OCR 及系统语言包；本轮无新增 npm 依赖或外部渲染器。长译文排版使用 Chromium SVG/Canvas。测试用 GnuTLS 手册图片从本机 Git 文档读取，不进入产品。OCR 坐标旋转参考 [Microsoft 的 TextAngle 文档](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrresult.textangle)。
- 构建执行 `npm run build:prototype`。组内 `npm ci --offline` 在启动子进程时报错，构建复用了平台工作树已安装的依赖；两处锁文件 SHA-256 均为 `a7aaae5fcbea64e1b2c0baf2275adbe3a36e0fe35bd884f2bfef537cf098efe4`。
- 复测截图和取色用 `python scripts/toolkit-color-desktop.py`，PDF 和模型回环用同脚本加 `--pdf`。流程图用 `node scripts/check-toolkit-diagram.mjs`，解包独立程序加 `--packaged`。快捷键用 `node scripts/check-toolkit-runtime.mjs`，共享设置用 `node scripts/check-toolkit-connections.mjs`。截图/PDF 脚本暂借剪贴板和焦点后恢复，图表样张短时显示；请在合适时段运行。

## 本地交付检查

- 实际执行 `node scripts/build-installers.mjs --toolkit`，在本组缓存生成未签名的开发验收包 `.cache/fitbay-build/toolkit/FitBay-Toolkit-Setup-0.1.0-x64.exe`，SHA-256 为 `ab87acb464dca846c7ebf16ea397b4990dad9e45f055d876cbcdf7735ca07613`。7-Zip 初次压缩遇到本机内存不足，限制构建进程为一个可用 CPU 后按默认压缩参数构建成功。拆开 NSIS 内层 app-64.7z，14 项关键资源与实际启动的 win-unpacked 目录哈希逐项一致，涵盖上列文件及三项连接模块。未运行安装、卸载或发布。
- 本机已装提示词库，独立 EXE 能看到临时 profile 中的「解释推导」。在同一程序内将测试进程的 HKCU 查询临时指向只读隔离子树，模拟组件缺席，旧动作消失，框选和贴图仍可用。测试不修改真实安装登记。复验命令为 `python scripts/toolkit-color-desktop.py --absent`。
- 在干净的提交检出运行 `npm run check`，doctor 和下拉 ESLint 通过，全仓格式检查停在六份基线交接文档。其余步骤单独执行：Biome lint、诊断和平台测试、TypeScript 与应用构建通过。工作台生产交互用例 17/17；开发配置首次 15/17，失败两例单独复跑均通过。三个本组变更及当前 toolkit-runtime 规范严格校验通过；全仓 OpenSpec 为 62 通过、Music 的 music-optional-plugins 规范 1 项未通过。
- 真实供应商服务按用户安排留待用户验证。公共 CMD 集成、正式安装升级与远程 CI 尚未在本组执行。
