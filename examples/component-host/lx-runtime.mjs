import { Worker } from 'node:worker_threads'
export class SourceRequestError extends Error {}
export function runSource(code, payload, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('lx-worker.mjs', import.meta.url), {
      workerData: { code, payload },
    })
    function stop() {
      finish(Error('操作已取消'))
    }
    let finished = false
    function finish(error, value) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      void worker.terminate()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(
      () => finish(new SourceRequestError('音乐源响应超时')),
      payload ? 55000 : 6000,
    )
    signal?.addEventListener('abort', stop, { once: true })
    worker.once('message', (msg) =>
      finish(
        msg.error ? new SourceRequestError('音乐源未能完成请求，请检查源或稍后重试') : null,
        msg.value,
      ),
    )
    worker.once('error', () => finish(Error('音乐源启动失败')))
    worker.once('exit', () => finish(Error('音乐源已结束')))
  })
}
