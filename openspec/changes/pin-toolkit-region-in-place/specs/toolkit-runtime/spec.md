## ADDED Requirements

### Requirement: 原位贴图

工具集 SHALL 支持原位贴图。

#### Scenario: 从现有入口调用

- **WHEN** 用户在工具集框选并点击常显图钉
- **THEN** 选区保持原色，工具栏避开边缘。无边框置顶图按来源屏 DIP 坐标和尺寸出现；图像绘制成功才释放框选。失败可重试，贴图可拖动、滚轮缩放、Esc 关闭。
