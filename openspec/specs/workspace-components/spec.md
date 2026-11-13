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

### Requirement: 设置叠加在停靠内容上

工作台 SHALL 在打开设置和嵌套选项列表时继续显示正在运行的停靠视图，保留页面、滚动位置及播放会话。

#### Scenario: 在播放中的曲库展开设置

- **WHEN** 用户在已滚动的停靠曲库中打开设置并展开字体
- **THEN** 设置外仍显示原列表和播放器，播放时间继续推进，关闭后在原位置继续操作

### Requirement: 公共选项列表材质

工作台和停靠组件 SHALL 使用主题的灰蓝深色玻璃、前景、选中、悬停与键盘焦点样式，按工作台的三个材质参数更新。

#### Scenario: 首次使用与恢复默认

- **WHEN** 偏好缺失或用户点击材质恢复默认
- **THEN** 透明度、磨砂强度、背景亮度均为 100%，恢复仅覆盖这三个字段

#### Scenario: 已有材质与停靠列表

- **WHEN** 用户打开已有偏好的工作台，在 Music 停靠时调整材质并展开未收听时间
- **THEN** 加载保存的数值，音乐和工作台列表使用相同材质规则，分离后组件退出工作台参数的作用范围

### Requirement: First empty workspace entry

The desktop workbench SHALL offer a direct action on a new empty workspace based on actual Music availability and SHALL preserve deliberately empty saved layouts.

#### Scenario: Music installed

- **WHEN** a new empty workspace has an installed Music component
- **THEN** 打开 Music opens the component in the workspace

#### Scenario: Music absent

- **WHEN** Music is absent and the user selects 添加组件
- **THEN** the workbench offers the real matching Windows Music installer and refreshes availability after installation or cancellation

#### Scenario: Previously used workspace

- **WHEN** the user closes the last component and restarts
- **THEN** the workspace stays empty without the first-run action
