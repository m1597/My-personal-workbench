# toolkit-capture Specification

## Purpose

规定独立和停靠入口中用户能观察并复测的行为，兼顾取消后的恢复与本地数据的完整性。工具集 SHALL 保持拖选区域原图可见并显示复制、保存、标注和贴图按钮。

## Requirements

### Requirement: 彩色选区与退出

工具集 SHALL 保持拖选区域原图可见并显示复制、保存、标注和贴图按钮。

#### Scenario: 连续截图

- **WHEN** 用户从停靠、独立或快捷键连续框选两次
- **THEN** 粘贴结果与选区像素相符，Esc 释放全屏输入。
