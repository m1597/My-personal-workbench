# 工具集批量交接 v1

文件库可信宿主调用 toolkitLauncher 返回的 launch(false, tool, requestId)。tool 为 rename 或 resize。启动参数为 --toolkit-page=<tool> 和 --toolkit-batch=<UUID>。文件库先在共享 profile/toolkit/incoming/<UUID>.json 原子写入 {version:1,tool,files:[绝对文件路径]}。最多 100 项。工具集首次或二次实例入口校验 UUID、用途、数量及磁盘文件，读取后移除请求，为当前窗口创建本地文件 ID，直接进入对应工具预览，由用户确认执行。工具集缺席或启动失败由发送端提示。
