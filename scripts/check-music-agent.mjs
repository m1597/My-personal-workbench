import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { _electron as electron } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

// Exercises the installed Codex MCP client, without a model turn or the user's music profile.
const profile = await mkdtemp(path.resolve('tmp/music-agent-'))
// Test manual import starting with an empty source bank after onboarding.
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('lx-bootstrap', 'done')
store.db.close()
const server = 'fitbay_music'
async function run(check) {
  const app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  let proc
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.music-shell')
    proc = spawn(process.env.FITBAY_CODEX_BIN || 'codex.exe', ['app-server'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let seq = 0
    const waiting = new Map()
    const write = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n')
    const lines = createInterface({ input: proc.stdout })
    lines.on('line', (line) => {
      const message = JSON.parse(line)
      const answer = waiting.get(message.id)
      if (answer && !message.method) answer(message)
    })
    function request(method, params) {
      const id = ++seq
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(Error(method + ' timeout'))
        }, 150000)
        waiting.set(id, (msg) => {
          clearTimeout(timer)
          waiting.delete(id)
          if (msg.error) reject(Error(msg.error.message))
          else resolve(msg.result)
        })
        write({ id, method, params })
      })
    }
    await request('initialize', {
      clientInfo: { name: 'fitbay_acceptance', version: '1' },
      capabilities: { experimentalApi: true },
    })
    write({ method: 'initialized', params: {} })
    const { thread } = await request('thread/start', {
      cwd: process.cwd(),
      ephemeral: true,
      config: { ['mcp_servers.' + server + '.args']: ['scripts/music-source-mcp.mjs', profile] },
    })
    async function call(tool, args = {}) {
      const result = await request('mcpServer/tool/call', {
        threadId: thread.id,
        server,
        tool,
        arguments: args,
      })
      if (result.isError) throw Error(result.content[0].text)
      return JSON.parse(result.content[0].text)
    }
    return await check(call)
  } finally {
    proc?.stdin.end()
    await app.close()
  }
}

const expected = await run(async (call) => {
  const initial = await call('list_sources')
  assert.ok(initial.catalog.length >= 2)
  assert.equal(initial.installed.length, 0)
  const [a] = await call('import_sources', { ids: ['fish'] })
  assert.ok(a.id, a.error)
  assert.equal((await call('list_sources')).active, a.id)
  const [same, b] = await call('import_sources', { ids: ['fish', 'huibq'] })
  assert.equal(same.id, a.id)
  assert.ok(b.id, b.error)
  assert.equal((await call('list_sources')).active, a.id)
  assert.ok((await call('source_capabilities', { id: b.id })).platform)
  for (const id of [b.id, a.id]) {
    await call('select_source', { id })
    assert.equal((await call('list_sources')).active, id)
  }
  const state = await call('list_sources')
  assert.equal(state.installed.length, 2)
  await assert.rejects(call('import_sources', { ids: ['missing-fixture-id'] }), /未知/)
  assert.deepEqual(await call('list_sources'), state)
  return state
})
await run(async (call) => assert.deepEqual(await call('list_sources'), expected))
console.log('PASS Codex 原生 MCP 客户端列目录、多选导入、查能力、切回、失败保留与双进程重启恢复')
