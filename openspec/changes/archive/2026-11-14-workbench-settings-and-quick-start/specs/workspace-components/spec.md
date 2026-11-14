## ADDED Requirements

### Requirement: 工作台整页设置与紧凑工具栏

工作台 SHALL 在主窗口提供外观、布局与启动、组件管理和跨分类搜索。顶部保留组件、布局和设置入口，仅品牌字使用 Lobster。

#### Scenario: 播放中访问设置

- **WHEN** 用户在播放中的工作台打开设置，搜索字号、材质或音乐设置
- **THEN** 对应控件可以直接定位；返回后恢复原工作区与播放实例，进入音乐设置使用 Music 自己的页面

#### Scenario: 布局与启动

- **WHEN** 用户选择恢复上次工作区、空白工作台或一个已保存布局
- **THEN** 下次启动按所选策略恢复；运行中切换布局只更新组件呈现，后台音乐继续播放

#### Scenario: 两个组件排列

- **WHEN** 当前工作区有两个可排列的组件
- **THEN** 布局菜单可左右或上下并排，分隔线可拖动；窄窗口收起布局名，保留组件与布局入口

### Requirement: 空工作区快速开始

工作台 SHALL 在空工作区列出实际检测到的组件及其图标，保留获取尚未安装的 Music 的入口。

#### Scenario: 新装与后台组件

- **WHEN** 工作台保持空白时安装受支持组件，或 Music 正在后台播放
- **THEN** 快速开始更新列表，单击组件铺满工作区；恢复后台 Music 时保留既有播放实例和进度

## REMOVED Requirements

### Requirement: 设置叠加在停靠内容上

**Reason**: 设置改为主窗整页。
**Migration**: 使用原偏好键和原播放会话。

### Requirement: First empty workspace entry

**Reason**: 空工作区统一提供快速开始。
**Migration**: 保留已有空布局。
