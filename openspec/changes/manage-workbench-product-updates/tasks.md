## 1. 实现

- [x] 1.1 按安装清单检查，显示上次检查时间，首行工作台，其后仅实际安装组件，各行显示本地、可用版本及操作。
- [x] 1.2 独立更新，只下载校验 Music 安装包，完整性通过才交给安装器。
- [x] 1.3 按项恢复，其余行状态保留，失败、最新、可更新和未接入在线更新可区分。
- [x] 1.4 后台与托盘，齿轮出现小蓝点，托盘进入同一更新页，窄窗可完成操作。

## 2. 实测

- [x] 2.1 在实际界面从齿轮进入更新并检查全部，验证并记录结果。
- [x] 2.2 在实际界面工作台已最新且 Music 有新版，点击 Music 更新，验证并记录结果。
- [x] 2.3 在实际界面单项检查失败后重试，验证并记录结果。
- [x] 2.4 在实际界面后台检查发现新版后从托盘检查更新，验证并记录结果。
- [x] 2.5 严格规范校验并记录限制。

## 验收记录

真实联网：2026-11-20 从开发宿主设置页主动检查，GitHub 最新稳定发行 v0.1.0，FitBay 与 Music 本地版本均为 0.1.0，显示已是最新。示例组件显示未接入在线更新。见 [界面检查结果](../../../tmp/settings-integration-sj8Qlr/live.json)。

受控发行：使用隔离 profile 与真实 FitBay.exe，在临时包内替换安装位置查询、发行响应及安装器启动边界。工作台版本 0.2.0，Music 0.1.0，测试发行 0.2.0。后台定时检查出现蓝点，再从齿轮检查全部，只有 Music 出现更新按钮。点击后仅下载 Music 的测试字节，完成大小及 SHA-256 校验，交给对应安装器路径。见[安装交接记录](../../../tmp/updates-packaged-VpnOkZ/launch.json)和[更新页](../../../tmp/updates-packaged-VpnOkZ/available.png)。测试没有执行真实覆盖安装。另以 503 模拟检查失败，单项重试后其余行保持失败。从实际托盘菜单回调进入同页，见[窄窗截图](../../../tmp/settings-integration-sj8Qlr/updates.png)。

复验入口为 scripts/check-packaged-update-page.mjs、scripts/check-workbench-settings-integration.mjs、tests/product-updates.test.mjs。后者另覆盖损坏包清理。
