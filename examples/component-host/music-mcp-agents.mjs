import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { access, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const exec = promisify(execFile)
const key = 'fitbay_music'
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  )
async function executable(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue
    const file = path.join(dir, name)
    if (await exists(file)) return file
  }
}
async function readJson(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return { raw: null, value: {} }
    throw e
  }
  const value = JSON.parse(raw.replace(/^\uFEFF/, ''))
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value.mcpServers !== undefined &&
      (!value.mcpServers ||
        typeof value.mcpServers !== 'object' ||
        Array.isArray(value.mcpServers)))
  )
    throw Error('Agent 配置格式无法读取')
  return { raw, value }
}
async function changeClaude(file, expected, entry) {
  const { raw, value } = await readJson(file)
  if (!isDeepStrictEqual(value.mcpServers?.[key], expected)) throw Error('配置已变化，请刷新后重试')
  value.mcpServers ??= {}
  if (entry) value.mcpServers[key] = entry
  else delete value.mcpServers[key]
  const temp = file + '.' + randomUUID()
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    if ((await readJson(file)).raw !== raw) throw Error('配置已变化，请刷新后重试')
    await rename(temp, file)
  } finally {
    await rm(temp, { force: true })
  }
}
export function musicMcpAgents(profile, script, store) {
  const connected = new Map()
  let changing = false
  const claudeDir = path.join(process.env.APPDATA || os.homedir(), 'Claude')
  const claudeFile = path.join(claudeDir, 'claude_desktop_config.json')
  const run = (exe, args) =>
    exec(exe, ['mcp', ...args], { cwd: os.tmpdir(), windowsHide: true, timeout: 10000 })
  async function agents() {
    const result = []
    const codex = await executable('codex.exe')
    if (codex) result.push({ id: 'codex', name: 'Codex', exe: codex })
    if (await exists(claudeDir)) result.push({ id: 'claude', name: 'Claude Desktop' })
    return result
  }
  const readOwned = (id) => JSON.parse(store().get('mcp-owned-' + id) || 'null')
  async function current(agent) {
    if (agent.id === 'claude') return (await readJson(claudeFile)).value.mcpServers?.[key]
    const { stdout } = await run(agent.exe, ['list', '--json'])
    return JSON.parse(stdout).find((row) => row.name === key)
  }
  async function toggle(id, enable) {
    if (typeof enable !== 'boolean' || changing) throw Error('请等待配置完成')
    changing = true
    try {
      const agent = (await agents()).find((item) => item.id === id)
      if (!agent) throw Error('未检测到支持的 Agent')
      const previous = await current(agent)
      const owned = readOwned(id)
      if (!enable) {
        if (owned && previous && isDeepStrictEqual(previous, owned.entry)) {
          if (agent.id === 'claude') await changeClaude(claudeFile, previous)
          else await run(agent.exe, ['remove', key])
        }
        store().set('mcp-owned-' + id, '')
        return
      }
      if (previous) {
        if (owned && isDeepStrictEqual(previous, owned.entry)) return
        throw Error('同名服务已存在，已保留原配置')
      }
      const token = randomUUID()
      const node = await executable('node.exe')
      const command = node || process.execPath
      const env = { FITBAY_MUSIC_CONNECTION: token, ...(node ? {} : { ELECTRON_RUN_AS_NODE: '1' }) }
      const args = [script, profile]
      const entry = { command, args, env }
      if (agent.id === 'claude') await changeClaude(claudeFile, undefined, entry)
      else
        await run(agent.exe, [
          'add',
          key,
          ...Object.entries(env).flatMap(([k, v]) => ['--env', k + '=' + v]),
          '--',
          command,
          ...args,
        ])
      store().set(
        'mcp-owned-' + id,
        JSON.stringify({ token, entry: agent.id === 'claude' ? entry : await current(agent) }),
      )
    } catch (error) {
      if (error.code || error instanceof SyntaxError)
        throw Error('无法更新 Agent 配置，请检查客户端和配置文件。')
      throw error
    } finally {
      changing = false
    }
  }
  return {
    list: async () =>
      Promise.all(
        (await agents()).map(async ({ id, name }) => {
          const owned = readOwned(id)
          return {
            id,
            name,
            enabled: Boolean(owned),
            connected: Boolean(owned && Date.now() - (connected.get(owned.token) || 0) < 35000),
          }
        }),
      ),
    toggle,
    authorized: (token) => ['codex', 'claude'].some((id) => readOwned(id)?.token === token),
    heartbeat(token) {
      if (['codex', 'claude'].some((id) => readOwned(id)?.token === token))
        connected.set(token, Date.now())
    },
  }
}
