## ADDED Requirements

### Requirement: 工作区底部和 Music 标签间距

工作台 SHALL 将工作区底边留给组件内容；Music 为组中唯一标签时，标签下方增加留白。

#### Scenario: 底部空间

- **WHEN** 打开空工作区或有组件的布局
- **THEN** 原常驻状态栏及其中的就绪文字、圆点、分隔符和数量均移除，内容可使用释放的高度。

#### Scenario: 单标签和混合分组

- **WHEN** 同一组在仅有 Music 和含多个标签之间切换
- **THEN** 单独 Music 标签呈现额外下方间距；多标签组使用原间距并可照常切换。
