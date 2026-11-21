## 实现与验收

- [x] 组件可重开，宿主正常退出，无 database is not open 或残留监听器。

在临时宿主副本关闭原有幂等保护，按「打开 API 设置 → 关闭组件 → 重开 → 带组件退出」复现用户截图调用栈。当前宿主先取走服务引用，再释放并校验视图存活状态。隔离 profile 中分别验证停靠单关、重开、带组件退出，以及分离后取消首次退出并再次退出。两次进程退出码均为 0，无主进程错误。复现与复验日志位于本机临时目录 fitbay-dispose-evidence-hTQxQf、fitbay-dispose-evidence-rN93rU、fitbay-dispose-evidence-cnC60L。
