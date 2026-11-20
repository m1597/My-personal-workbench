## 1. 实施与验收

- [x] 1.1 仓库 MUST 为固定文件生成持久 ID，并在每次执行时读取当前文件。
- [x] 1.2 修改「解释推导」后再次截图使用新模板；删除文件返回 FILE_UNAVAILABLE。

实测从仓库编辑器固定图片动作。真实工具集两次框选测试画面，回环端点收到 PNG 和先后两版模板，分别为「联测一：写出推导过程」「联测二：解释每一步的依据」。记录在本地 tmp/prompts-5UFikK/joint.json。删除文件返回 FILE_UNAVAILABLE，缺席返回 COMPONENT_ABSENT。
