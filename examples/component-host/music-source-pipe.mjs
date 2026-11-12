import net from 'node:net'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import path from 'node:path'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { realpath, lstat } from 'node:fs/promises'
const run = promisify(execFile)
export async function sourceEndpoint(profile, operation) {
  if (process.platform !== 'win32') throw Error('本地音源接口需要 Windows')
  const executable = path.join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script = fileURLToPath(new URL('./music-source-private.ps1', import.meta.url))
  try {
    const key = createHash('sha256')
      .update((await realpath(profile)).toLowerCase())
      .digest('hex')
    const { stdout } = await run(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        operation,
        key,
      ],
      { windowsHide: true, timeout: 10000 },
    )
    const endpoint = stdout.trim()
    const stat = await lstat(endpoint).catch((e) => {
      if (e.code !== 'ENOENT') throw e
    })
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw Error()
    return endpoint
  } catch {
    throw Error('当前用户的专用音源连接目录不可用')
  }
}
const pipePrefix = '\\\\.\\pipe\\fitbay-music-sources-'
const validId = { type: 'string', maxLength: 96 }
const schema = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
export const sourceTools = [
  {
    name: 'list_sources',
    description: '列出 pdone 音源目录、已导入音源和当前选择。',
    inputSchema: schema({}),
  },
  {
    name: 'import_sources',
    description: '按目录 ID 导入选中的音源，保留当前选择。',
    inputSchema: schema({ ids: { type: 'array', items: validId, minItems: 1, maxItems: 20 } }),
  },
  {
    name: 'source_capabilities',
    description: '查看已导入音源声明的搜索、取址、音质和永久保存能力。',
    inputSchema: schema({ id: validId }),
  },
  {
    name: 'select_source',
    description: '切换到指定的已导入音源。',
    inputSchema: schema({ id: validId }),
  },
]
export function validCall(name, args) {
  const tool = sourceTools.find((t) => t.name === name)
  if (!tool || !args || typeof args !== 'object' || Array.isArray(args)) return false
  const keys = Object.keys(args)
  if (
    keys.length !== tool.inputSchema.required.length ||
    !keys.every((key) => Object.hasOwn(tool.inputSchema.properties, key))
  )
    return false
  if (name === 'list_sources') return true
  if (name === 'import_sources')
    return (
      Array.isArray(args.ids) &&
      args.ids.length > 0 &&
      args.ids.length <= 20 &&
      args.ids.every((id) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(id))
    )
  return (
    typeof args.id === 'string' && /^(?:pdone:[a-z0-9_-]{1,48}|sha256:[a-f0-9]{64})$/.test(args.id)
  )
}
// A socket handles one bounded, newline-delimited message.
function receive(socket, limit) {
  return new Promise((resolve, reject) => {
    let length = 0
    const parts = []
    const fail = () => reject(Error('本地音源连接中断'))
    socket.on('error', fail)
    socket.once('close', fail)
    const onData = (chunk) => {
      length += chunk.length
      if (length > limit) {
        reject(Error('音源消息过大'))
        socket.destroy()
        return
      }
      const end = chunk.indexOf(10)
      parts.push(end < 0 ? chunk : chunk.subarray(0, end))
      if (end >= 0) {
        socket.removeListener('data', onData)
        try {
          resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))
        } catch {
          reject(Error('无效消息'))
        }
      }
    }
    socket.on('data', onData)
  })
}
export async function startSourcePipe(profile, call) {
  const token = randomBytes(32).toString('hex')
  const handle = randomBytes(20).toString('hex')
  const endpoint = await sourceEndpoint(profile, 'publish')
  const sockets = new Set()
  const server = net.createServer(async (socket) => {
    sockets.add(socket)
    const controller = new AbortController()
    socket.once('close', () => {
      sockets.delete(socket)
      controller.abort()
    })
    socket.setTimeout(10000, () => socket.destroy())
    try {
      const request = await receive(socket, 16384)
      if (
        typeof request?.token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.token) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(request.token))
      )
        throw Error('未授权')
      if (!validCall(request.name, request.args)) throw Error('未知操作或参数无效')
      socket.setTimeout(600000)
      const value = await call(request.name, request.args, controller.signal)
      socket.end(JSON.stringify({ value }) + '\n')
    } catch (e) {
      if (!socket.destroyed)
        socket.end(JSON.stringify({ error: e.code ? '本地音源操作失败' : e.message }) + '\n')
    }
  })
  server.maxConnections = 8
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipePrefix + handle, resolve)
  })
  try {
    const temp = endpoint + '.' + handle
    await writeFile(temp, JSON.stringify({ handle, token }), { mode: 0o600, flag: 'wx' })
    await rename(temp, endpoint)
  } catch (e) {
    server.close()
    throw e
  }
  return () => {
    server.close()
    for (const socket of sockets) socket.destroy()
    try {
      unlinkSync(endpoint)
    } catch {}
  }
}
export async function requestSourceTool(profile, name, args, signal) {
  if (!validCall(name, args)) throw Error('未知操作或参数无效')
  let descriptor
  try {
    descriptor = JSON.parse(await readFile(await sourceEndpoint(profile, 'connect'), 'utf8'))
  } catch {
    throw Error('请先打开此配置的 FitBay 或 Music')
  }
  if (!/^[a-f0-9]{40}$/.test(descriptor.handle) || !/^[a-f0-9]{64}$/.test(descriptor.token))
    throw Error('本地音源端点无效，请重新打开 FitBay')
  const socket = net.connect(pipePrefix + descriptor.handle)
  const abort = () => socket.destroy()
  signal?.addEventListener('abort', abort, { once: true })
  socket.setTimeout(600000, abort)
  try {
    signal?.throwIfAborted()
    const reply = receive(socket, 2 * 1024 * 1024)
    socket.write(JSON.stringify({ token: descriptor.token, name, args }) + '\n')
    const result = await reply
    if (result.error) throw Error(result.error)
    return result.value
  } finally {
    socket.destroy()
    signal?.removeEventListener('abort', abort)
  }
}
