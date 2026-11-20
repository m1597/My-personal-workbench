## Context

在光标所在显示器框选，以原始像素复制、保存 PNG 或生成可关闭的置顶贴图。

## Decisions

主进程用 desktopCapturer 冻结鼠标所在显示器，以显示坐标比例换算到原图像素。沙箱页面只提交矩形与已知动作。Snipaste 仅作交互参考 https://docs.snipaste.com/ 。

## Risks / Trade-offs

取消或空选区：Escape 取消；空选区可重新框选，整个流程无模型请求。
