## 实现

- [x] 1.1 按真实 Music 单标签和多标签的几何统一宿主标签栏。

## 桌面实测

- [x] 2.1 从后台工作台依次打开 Music、工具集、文件库及示例组件，检查单格、左右、四格及同格切换。

## 结果

隔离 Electron 工作台复现原间距差异后，使用同一操作序列复测。单独 Music 及左右、2×2 的各栏均为 38px；Music 与工具集混合后各栏均为 32px。标签顶距均为 4px，图标 16px，标签文字及关闭按钮中心在 0.05 CSS px 容差内重合。激活工具集与激活 Music 的选中底色及 2px 内下划线一致。四格同排内容起点差为 0，三个原生子视图与宿主内容起点偏差在 1px 以内。另在八组件测试中验证混合单标签与多标签的四格布局。全程在隔离后台窗口操作。

[修复前的实测数据](../../../../tmp/host-tabs-98yH54/metrics.json) · [修复后的实测数据](../../../../tmp/host-tabs-hbg4aD/metrics.json) · [左右分窗](../../../../tmp/host-tabs-hbg4aD/split.png) · [四格](../../../../tmp/host-tabs-hbg4aD/four.png) · [选中 Music](../../../../tmp/host-tabs-hbg4aD/mixed-music.png) · [选中工具集](../../../../tmp/host-tabs-hbg4aD/mixed-toolkit.png) · [四格混合分组](../../../../tmp/default-grid-Ypp8GE/grid.json)。

截图记录宿主合成层，原生子视图位置另用 Electron 读取。未逐台验证其他显示器和系统缩放组合。

从桌面 FitBay.cmd --verify-desktop 再次打开 Music 和工具集，两个标签栏底边均为 82 CSS px。见[桌面入口局部截图](../../../../tmp/desktop-check-29545-4223/split-bars.png)及[入口数据](../../../../tmp/desktop-check-29545-4223/tab-check.json)。
