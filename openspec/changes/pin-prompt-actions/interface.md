# 固定动作读取接口 v1

可信主进程导入 `examples/component-host/prompt-actions.mjs`（构建后与 host/main.mjs 同级）。`createPromptActionReader({profile, installed})` 接收公共宿主的绝对 userData 路径和同步组件存在性回调。返回异步方法 `listActions()`、`resolveAction(id)`。

列表成功返回 `{ok:true,actions:[{id,displayName,inputType}]}`。inputType 为 `text` 或 `image`。解析成功返回 `{ok:true,action:{id,displayName,inputType,template}}`。template 是此刻 UTF-8 文件全文。固定时产生 UUID，同一固定项改名不改 ID。工具集在每次执行（包括每次截图）时重新解析；不得持久化模板副本。

失败返回 `{ok:false,error}`。组件未安装 COMPONENT_ABSENT，ID 不存在 ACTION_NOT_FOUND，文件失效或不可读 FILE_UNAVAILABLE，动作索引损坏 INDEX_UNAVAILABLE。组件未运行仍可读取。
