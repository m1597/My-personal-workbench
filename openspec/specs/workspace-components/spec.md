# workspace-components Specification

## Purpose

日常工作区只展示可运行组件，恢复布局时清理退役占位标签并保留可用组件。已有用户仍可在原工作台中恢复 Music 的排列和活动标签。

## Requirements

### Requirement: 真实组件工作区

工作台 SHALL 从空工作区提供 Music 入口，恢复时只清除退役或不可用的引用。

#### Scenario: 混合旧布局

- **WHEN** 旧布局包含 Music、其他有效组件和退役占位标签
- **THEN** 恢复有效分组和活动标签，收拢空组并将旧音乐标题更新为 Music

#### Scenario: 首次启动或空布局

- **WHEN** 首次启动、只保存了占位窗口或已经关闭所有组件
- **THEN** 展示空工作区，仍可打开 Music 并停靠或分离

### Requirement: 工作区底部和 Music 标签间距

工作台 SHALL 将工作区底边留给组件内容；Music 为组中唯一标签时，标签下方增加留白。

#### Scenario: 底部空间

- **WHEN** 打开空工作区或有组件的布局
- **THEN** 原常驻状态栏及其中的就绪文字、圆点、分隔符和数量均移除，内容可使用释放的高度。

#### Scenario: 单标签和混合分组

- **WHEN** 同一组在仅有 Music 和含多个标签之间切换
- **THEN** 单独 Music 标签呈现额外下方间距；多标签组使用原间距并可照常切换。
