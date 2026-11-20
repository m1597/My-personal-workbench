## ADDED Requirements

### Requirement: PDF 划词

工具集 SHALL 支持PDF 划词。

#### Scenario: 从桌面入口使用

- **WHEN** 用户发起PDF 划词
- **THEN** 在 PDF 阅读器选择文字后按快捷键，展示所选原文及翻译、解释和自由提问入口。

#### Scenario: 没有选中文字

- **WHEN** 没有选中文字
- **THEN** 显示重新选择提示，不把旧剪贴板当作选区。
