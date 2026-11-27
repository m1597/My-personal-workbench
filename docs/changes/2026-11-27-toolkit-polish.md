# 工具集入口与选区结果验收

开发分支 team/toolkit，在隔离 profile 中启动开发构建工作台，通过「组件 → 工具集」进入。另启动同一工作树的独立工具集。三个入口分别为屏幕截图、划词助手和屏幕取色。普通框选与取色无需 API。模型测试连接只监听本机。

| 入口与操作                 | 观察与证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页、齿轮、API 下拉及返回 | [320px 首页](../../tmp/toolkit-shell-gfqU1k/standalone-320.png)、[600px](../../tmp/toolkit-shell-gfqU1k/standalone-600.png)、[850px](../../tmp/toolkit-shell-gfqU1k/standalone-850.png)。截图、选词、取色图标均为 27px 白色线条，按钮右边缘误差小于 1px。停靠页可在原窗格[展开用途](../../tmp/toolkit-shell-gfqU1k/dock-api-open.png)并返回；独立与停靠切换的宿主及组件托盘数为 1+0、1+1、1+0、1+1。                                                                                                                                    |
| Music 实物对照             | [Music 首页](../../tmp/toolkit-shell-gfqU1k/music-home.png)、[设置](../../tmp/toolkit-shell-gfqU1k/music-settings.png)。[两侧齿轮](../../tmp/toolkit-shell-gfqU1k/gear.json)的图形路径一致，点击区同为 30×28。工作台明暗与透明度两端值实时反映到独立窗口。                                                                                                                                                                                                                                                                              |
| 截图翻译、问 AI            | 从停靠按钮框选生成屏幕中的 GnuTLS 流程图，真实 Windows OCR 识别 16 块。回环响应首次缺块，在原窗口重试，相同请求。请求期间翻译和问 AI 均禁用；切换三模式零额外调用。[原图](../../tmp/toolkit-diagram-Mw2Mvv/original.png)、[仅中文](../../tmp/toolkit-diagram-Mw2Mvv/chinese.png)、[双语](../../tmp/toolkit-diagram-Mw2Mvv/bilingual.png)。两种覆盖模式框外变化均为零，2614 个蓝色连线像素零损伤。默认比例过小的双语块保留原标签，可点击显示完整原文和译文。对同一选区问 AI 和连续两次追问携带同一 PNG。关闭后再次框选并 Esc，遮罩关闭。 |
| 21 块部分失败恢复          | 模块测试替换 OCR 与模型。首次批次 20、1，第二批无有效回复，重试仅发最后 1 块，OCR 共一次。换连接、换图分别重新识别并发 20、1。结果窗按工作区 DIP 限制尺寸与位置，几何断言含负坐标与小于默认窗宽的工作区。                                                                                                                                                                                                                                                                                                                               |
| 连续点取颜色               | 生成的 150% 模拟副屏含两个已知色块。点取、复制 HEX 与 RGB 后回读系统剪贴板，[蓝](../../tmp/toolkit-diagram-Mw2Mvv/sample-35.png)为 #3978AD / 57,120,173，[红](../../tmp/toolkit-diagram-Mw2Mvv/sample-65.png)为 #C45B39 / 196,91,57。两次重新取色后 Esc 均关闭遮罩。                                                                                                                                                                                                                                                                    |
| 快捷键、API 失败恢复       | 独立窗口 UI 录制 F1 遇系统占用后保留原注册，F2、取消、单项恢复、组件全部恢复和两次重启通过。[设置](../../tmp/toolkit-runtime-ZMU66u/settings.png)。独立托盘的取色菜单和已注册的取色回调各触发、取消两次；键盘输入仅定向到测试窗口。缺少连接时从结果进入配置并返回重试，旧加密密钥迁移、组件/全局双向更新、复用和单独配置通过。[隔离运行目录](../../tmp/toolkit-connections-iPg8Ng)。                                                                                                                                                    |

复测使用以下命令，先构建开发版。窗口在后台运行，流程图脚本用测试像素替代桌面源。

```powershell
npm run build:prototype
node scripts/check-toolkit-shell.mjs
node scripts/check-toolkit-runtime.mjs
node scripts/check-toolkit-connections.mjs
node --experimental-test-module-mocks scripts/check-toolkit-resume.mjs
python scripts/toolkit-color-desktop.py --diagram
openspec validate polish-toolkit-existing-entries --strict
```

物理副屏当前未被 Windows 枚举。[显示器记录](../../tmp/toolkit-diagram-Mw2Mvv/display.json)列出实际显示器和模拟工作区。真实混合 DPI 落窗及系统全局按键触发待复核。Chrome PDF 的历史划词记录见[桌面工具集验收](2026-11-20-desktop-toolkit.md)。本轮尚未在物理桌面重跑外部应用划词。真实模型服务由用户自行验证。开发分支未制作安装包。

## 集成交接

实现提交 `b7df602` 已通过 `npm run build:prototype`。独立入口为 `FitBay Toolkit.exe`，停靠入口为 `FitBay.exe → 组件 → 工具集`。打包脚本递归复制工具集目录。结果窗新增 `resources/app/result-placement.mjs`，并使用同目录的 `main.mjs`、`image-translation.mjs`、`translated-diagram.js`、`ocr.ps1`、`selection.ps1` 及原有录制控件与样式。无新增运行时依赖。

`npm run check` 在全仓格式检查阶段停止，七个文件均未包含在实现提交中，见[完整检查记录](../../tmp/toolkit-polish-check.log)。工具集专项脚本、TypeScript、开发构建与本次 OpenSpec 严格校验通过。

工作台视口缩至 [360px](../../tmp/toolkit-shell-gfqU1k/dock-open-360.png) 和 [640px](../../tmp/toolkit-shell-gfqU1k/dock-open-640.png) 后，展开项的左右边缘均位于实际窗格内，返回保留上次设置分类。独立窗和停靠页的齿轮通过同一图形路径与点击区尺寸断言。

为复测本轮 PDF 划词，尝试创建未切换的独立 Win32 desktop，在其中启动已知文本编辑框。编辑框取得该线程的本地焦点，系统 GetForegroundWindow 仍未指向它，划词入口所需的真实前台条件不成立。探测未发送任何全局按键。历史回归另留有[外部 PDF 阅读器](../../tmp/toolkit-5cU7FF/viewer.png)和[划词结果](../../tmp/toolkit-5cU7FF/pdf-selection.png)。

### 普通结果窗材质

独立首页、截图结果、文字结果及取色结果共用工作台材质。后台打开窗口后将亮度从 15 调到 90、透明度从 25 调到 40；首页与打开的结果窗实时跟随，随后打开的文字及取色结果采用相同设置。[320px 首页与复制后的结果窗](evidence/toolkit-result-theme/home-and-result.png)、[复制失败](evidence/toolkit-result-theme/theme-copy-error.png)、[文字结果](evidence/toolkit-result-theme/theme-text.png)、[取色结果](evidence/toolkit-result-theme/theme-color.png)。

复测命令为 `python scripts/toolkit-color-desktop.py --diagram --result-theme`。使用隔离 profile、生成屏幕样张和回环模型。文字结果通过框选后「提取文字」打开，使用与外部划词相同的结果视图。切换材质前后，完整选区 PNG 一致，原图绘制区内像素逐一相同（排除外缘 1px 亚像素混合区），色块中心实际像素保持 RGB(57, 120, 173)，复制值为 #3978AD。
