import { workerData, parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { getQuickJS } from 'quickjs-emscripten'
import { sourceRequest } from './lx-net.mjs'
const engine = await getQuickJS()
const vm = engine.newContext()
vm.runtime.setMemoryLimit(24 * 1024 * 1024)
vm.runtime.setMaxStackSize(512 * 1024)
let deadline
vm.runtime.setInterruptHandler(() => Date.now() > deadline)
const queue = []
const emit = vm.newFunction('emit', (h) => {
  const raw = vm.getString(h)
  if (raw.length > 2 * 1024 * 1024 || queue.length >= 48) throw Error('源超出限制')
  queue.push(JSON.parse(raw))
})
vm.setProp(vm.global, 'fitbayEmit', emit)
emit.dispose()
function evaluate(code) {
  deadline = Date.now() + 600
  const result = vm.evalCode(code)
  if (result.error) {
    result.error.dispose()
    throw Error('音乐源脚本执行失败')
  }
  const ready = vm.eq(result.value, vm.true)
  result.value.dispose()
  return ready
}
const replies = []
let operations = 0
async function dispatch({ kind, id, url, options, ms }) {
  try {
    let result = null
    if (kind === 'timer') await wait(Math.min(5000, Math.max(0, Number(ms) || 0)))
    else if (kind === 'http' && typeof url === 'string' && url.length < 8192)
      result = await sourceRequest(url, options ?? {})
    else throw Error()
    replies.push([id, null, result])
  } catch {
    replies.push([id, '音乐源网络请求失败', null])
  }
}
const bootstrap = await readFile(new URL('lx-guest.js', import.meta.url), 'utf8')
try {
  evaluate(bootstrap)
  evaluate(workerData.code)
  let started = false
  main: while (true) {
    for (const reply of replies.splice(0)) evaluate('fitbayReply(...' + JSON.stringify(reply) + ')')
    if (!started)
      started = evaluate('fitbayRun(' + JSON.stringify(workerData.payload ?? null) + ')')
    deadline = Date.now() + 600
    const jobs = vm.runtime.executePendingJobs(64)
    if (jobs.error) {
      jobs.error.dispose()
      throw Error()
    }
    for (const op of queue.splice(0)) {
      if (op.kind === 'done') {
        parentPort.postMessage({ value: op.value })
        break main
      }
      if (op.kind === 'failed' || ++operations > 64) throw Error()
      void dispatch(op)
    }
    await wait(12)
  }
} catch {
  parentPort.postMessage({ error: true })
} finally {
  vm.dispose()
}
