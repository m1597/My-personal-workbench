import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Configuration is supplied by the operator at launch, never by tools/call.
const root = fileURLToPath(new URL('../', import.meta.url))
const installed =
  JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).fitbayProduct === 'music'
const { requestSourceTool, sourceTools, validCall } = await import(
  installed ? '../host/music-source-pipe.mjs' : '../examples/component-host/music-source-pipe.mjs'
)
const profile =
  process.argv[2] ||
  (installed
    ? path.join(process.env.APPDATA, 'FitBay', 'desktop-profile')
    : path.join(root, 'local', 'desktop-profile'))
if (!path.isAbsolute(profile) || process.argv.length > 3)
  throw Error('用法：node music-source-mcp.mjs [绝对 profile 路径]')
const version = '2025-06-18'
let phase = 'new'
const pending = new Map()
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value })
async function dispatch(msg) {
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    fail(null, -32600, '无效请求')
    return
  }
  const { id, method, params = {} } = msg
  if (id === undefined) {
    if (method === 'notifications/initialized' && phase === 'initializing') phase = 'ready'
    if (method === 'notifications/cancelled') pending.get(params.requestId)?.abort()
    return
  }
  if (typeof id !== 'string' && !Number.isSafeInteger(id)) {
    fail(null, -32600, '无效请求编号')
    return
  }
  if (method === 'initialize' && phase === 'new') {
    phase = 'initializing'
    result(id, {
      protocolVersion: version,
      serverInfo: { name: 'fitbay-music-sources', version: '1.0.0' },
      capabilities: { tools: {} },
    })
    return
  }
  if (method === 'ping') {
    result(id, {})
    return
  }
  if (phase !== 'ready') {
    fail(id, -32600, '请先初始化')
    return
  }
  if (method === 'tools/list') {
    result(id, { tools: sourceTools })
    return
  }
  if (method !== 'tools/call') {
    fail(id, -32601, '未知方法')
    return
  }
  const args = params?.arguments ?? {}
  if (!validCall(params?.name, args)) {
    fail(id, -32602, '未知工具或参数无效')
    return
  }
  if (pending.has(id) || pending.size >= 4) {
    fail(id, -32600, '请等待当前操作完成')
    return
  }
  const control = new AbortController()
  pending.set(id, control)
  try {
    const value = await requestSourceTool(profile, params.name, args, control.signal)
    if (!control.signal.aborted)
      result(id, { content: [{ type: 'text', text: JSON.stringify(value) }] })
  } catch (e) {
    if (!control.signal.aborted)
      result(id, { isError: true, content: [{ type: 'text', text: e.message }] })
  } finally {
    pending.delete(id)
  }
}
process.stdin.setEncoding('utf8')
let buffer = ''
for await (const chunk of process.stdin) {
  buffer += chunk
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n')
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    if (line.length > 16384) {
      fail(null, -32600, '请求过大')
      continue
    }
    try {
      void dispatch(JSON.parse(line)).catch(() => fail(null, -32603, '请求失败'))
    } catch {
      fail(null, -32700, '无效 JSON')
    }
  }
  if (buffer.length > 16384) break
}
for (const controller of pending.values()) controller.abort()
