- [x] 修复无边框贴图的原位定位、拖动缩放和绘制交接。
- [x] 停靠按钮 → 框选 → 图钉；故意解码失败保留原选区，重试后图像一致。系统识别 Sculptor 副屏，DIP 原点 (1707,0)，缩放 150%。隐藏实际窗口内容边界与副屏选区误差 ≤1 DIP，渲染图与选区缩至相同网格后三通道平均误差均小于 0.64/255，拖动、滚轮与 Esc 通过。复测命令为 `node scripts/check-toolkit-diagram.mjs --pin-in-place`。采样源为彩色测试画面，用户当时出现持续黑屏的实际桌面内容未复现。
- 设计参考 [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)。首次窗口绘制与图片解码分开确认。

- [x] 副屏原生实测：临时双色样张，注入黑缩略图后 Windows 按目标屏物理范围重新取像。原位贴图覆盖改绿的样张，直接从实际显示屏读回两点与原图一致，位置误差 0，尺寸误差 ≤1 DIP。复验 node scripts/check-toolkit-secondary-pin.mjs。
