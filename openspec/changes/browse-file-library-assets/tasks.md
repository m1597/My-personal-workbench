## 实现与验收

- [x] 目录保留层级和各目录视图，空格预览图片，同名 TXT 可打开；按默认当前目录或所有常用位置搜索，MD/TXT 可匹配正文。

独立与停靠窗口均已打开。旧设置、目录视图、范围切换、MD/TXT 正文、同名 TXT、复制和图片预览通过。只读打开现有 Serpent Assets / 图片素材，保持上下级目录，在 380 DIP 窄窗展开位置导航。[独立窄窗](../../../tmp/file-library-P3wyh9/narrow-locations.png) · [停靠文件列表](../../../tmp/file-library-P3wyh9/docked-files.png)。

## 工具集交接

文件库与工具集开发版本均为 0.1.0，读取协议 v1，组件标识 io.fitbay.prompts。可从独立或停靠的文件库选中解释推导.md，展开「固定为工具集动作」，选择图片输入。工具集截图后选择「解释推导」，预期每次提交都按同一动作 UUID 重新读取模板并附带截图 PNG；文件失效返回 FILE_UNAVAILABLE，缺少组件返回 COMPONENT_ABSENT。本轮复验清单、错误和运行时重读；两次截图的实际请求证据见[动作联测记录](../pin-prompt-actions/tasks.md)。
