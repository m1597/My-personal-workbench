# 工具集截图阻塞修复与跨组复测

实现提交 `8ab8180`。文件库入口使用 `b757532`，公共设置壳使用 `aee0eec`，宿主图标及窗口归属使用 `4247309`。

## 截图与任务栏

在 Windows 停靠入口复现点击复制后浮层停留，状态栏报 `clipboard.writeImage is not a function`。旧回归替换过该方法。当前使用锁定版 Electron 的异步剪贴板接口写 PNG，成功后关闭选区。屏幕浮层等待原图解码和拖选事件就绪；可选动作清单异步加载，主进程能响应 Esc。用户附件展示了停靠布局和菜单，无法据此确定用户现场整屏蓝色的唯一触发条件。[Electron 剪贴板接口](https://www.electronjs.org/docs/latest/api/clipboard)

用 `python scripts/toolkit-color-desktop.py` 在隔离 profile 显示红绿样张，经过桌面采集、选区工具栏、系统剪贴板和另一个可编辑窗口。每个入口复制两次，粘贴图像与选区解码后整张 PNG 一致，工具栏实际绘制的区域也核对了红绿像素。第三次框选按 Esc，窗口关闭，可再次触发。该测试短时显示样张、发送注册的系统快捷键；最后一次报告已恢复原窗口焦点。[停靠按钮](../images/toolkit-capture-repair/dock-region.png) · [独立窗口](../images/toolkit-capture-repair/home-region.png) · [系统快捷键](../images/toolkit-capture-repair/key-region.png)

同一选区进入测距与取色，色值与原图一致，两点差值符合当前显示器的物理像素比例。返回该选区后，Windows OCR 读出 FITBAY 321。复制、保存、标注和贴图按钮均可见；标注已有撤销及应用回归。

任务栏用正常前台模式另验。打开隔离工作台，点「组件 → 工具集 → 框选屏幕」，框选并点「贴图置顶」。贴图保持打开，重新聚焦工作台并展开 Windows 任务栏，按按钮边界去重，Explorer 辅助功能树实读 **FitBay 工作台，1 个运行窗口**，工具集无第二项。最终复测恢复了原前台焦点。工作台快速开始、菜单、停靠标签在实际渲染中读回同一 SVG 遮罩。Windows ICO 和 PNG 使用该 Lucide Toolbox 轮廓生成透明底单色图形，沿用公共控件使用的 ISC 许可。

## 设置和文件库

- 独立窗口及停靠窗格均可从公共齿轮进入快捷键和 API 设置。逐行对比填入两段文字，打开设置再返回，原输入保留。两个入口共用公共材质颜色；停靠视图随宿主材质变化。[停靠设置](../images/toolkit-capture-repair/dock-settings.png) · [独立设置](../images/toolkit-capture-repair/tool-settings.png)
- 文件库真实多选两个 PNG，点「改尺寸」，在工具集导出两份 800 × 600 副本并读回尺寸。再从文件库点「批量重命名」，预览、确认后原文件列表更新，原目录中仍有两张图片。发送端和接收端通过一次性批次交接，用户确认前不改名。[改名后的文件库](../images/toolkit-capture-repair/file-library.png)
- 复测命令为 `node scripts/check-file-library-controls.mjs`、`node scripts/check-toolkit-trials.mjs --host`、`node scripts/check-toolkit-trials.mjs` 与 `node scripts/check-toolkit-connections.mjs`。共享连接验证使用隔离配置，真实模型服务按用户要求留待单独验证。

OpenSpec 全库严格校验 61 项通过，TypeScript、原型构建及桌面启动入口检查通过。本轮运行的全库 npm check 停在十个本组以外文件的格式检查。未推送、发布或更改用户安装。
