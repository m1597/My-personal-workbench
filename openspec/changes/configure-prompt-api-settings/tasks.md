## 1. 设置与同步

- [x] 1.1 从独立与停靠的组件入口进入 API 设置，单独配置或显式复用已有连接。
- [x] 1.2 双向修改后检查状态和模型，并核对密钥遮盖与脱敏。

## 2. 委托执行与本地回归

- [x] 2.1 固定文本或图片动作时展示实际工具集连接与模型。
- [x] 2.2 空配置测试本地目录、编辑、搜索和插入，运行桌面回归。

## 桌面验收

- 独立仓库保存随机密钥并停靠后，工作台显示同一模型。两侧分别编辑，打开中的另一侧同步变化。同地址、同模型的两条连接可按用途区分，切回单独配置后工具集保留原绑定。脚本 `node scripts/check-prompt-connections.mjs`，截图见 [窄窗设置](../../../tmp/prompt-connections-u5Ttfo/standalone-narrow.png)、[停靠](../../../tmp/prompt-connections-u5Ttfo/docked.png)、[图片动作执行连接](../../../tmp/prompt-connections-u5Ttfo/action-connection.png)。
- `node scripts/check-prompts.mjs --desktop` 在空配置下通过外部编辑、冲突恢复、重启默认目录、外部输入框三步调用与失焦复制。[冲突现场](../../../tmp/prompts-ZjLDgZ/conflict.png)。动作运行时读取另见[截图联测](../pin-prompt-actions/tasks.md)。
- 启动独立包内的 FitBay Prompts.exe 两次，同一隔离 profile 中保存、重启后读取、更换随机凭据并通过系统解密回读。数据库与公开快照无测试凭据明文，错误与进程输出检查通过。此次验证使用测试地址，无外部模型计费请求。
