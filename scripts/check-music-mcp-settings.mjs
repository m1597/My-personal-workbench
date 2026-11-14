import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import { _electron as electron, expect } from '@playwright/test'

// Exercises the installed Codex MCP client, without a model turn or the user's music profile.
const profile = await mkdtemp(path.resolve('tmp/music-agent-'))
const server = 'fitbay_music'
const home = path.join(profile, 'codex-home')
const appData = path.join(profile, 'app-data')
await Promise.all([mkdir(home), mkdir(appData)])
const isolated = {
  ...process.env,
  CODEX_HOME: home,
  APPDATA: appData,
  WORKBENCH_TEST_BACKGROUND: '1',
}
const other = '[mcp_servers.other]\ncommand = "node"\nargs = ["--version"]\nenabled = false\n'
await writeFile(path.join(home, 'config.toml'), other)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('lx-bootstrap', 'done')
for (const title of ['片头', '上一首', '片尾']) {
  const file = path.join(profile, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ file, title, artist: '测试', album: '短片', duration: 20 })
}
const songs = store.library.list()
const track = (title) => songs.find((t) => t.title === title).id
store.library.heard(track('上一首'), Date.now() - 2000)
store.library.heard(track('片尾'), Date.now() - 1000)
const online = store.library.rememberOnline({
  id: 'online-recording-' + 'a'.repeat(64),
  title: '远端录音',
  artist: '在线艺人',
  album: '',
  duration: 90,
})
const commute = store.library.createPlaylist('通勤', [online], true)
const release = store.library.createPlaylist('在线歌单', [online], true)
store.db.close()
async function run(check) {
  const app = await electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST_DIR || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: isolated,
  })
  let proc
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.music-shell')
    await openMusicSettings(page)
    await selectMusicSettings(page, 'MCP')
    const toggle = page.getByRole('switch', { name: '允许本机 Agent 连接 Music' })
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(page.getByRole('status')).toContainText('需重启 Agent')
    assert.match(await readFile(path.join(home, 'config.toml'), 'utf8'), /mcp_servers.other/)
    proc = spawn(process.env.FITBAY_CODEX_BIN || 'codex.exe', ['app-server'], {
      env: isolated,
      cwd: home,
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
      cwd: home,
      ephemeral: true,
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
    await check(call)
    await expect(page.getByRole('status')).toContainText('已连接', { timeout: 15000 })
    await page.screenshot({ path: path.join(profile, 'connected.png') })
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await assert.rejects(call('list_playlists', { offset: 0 }), /连接已关闭/)
    const config = await readFile(path.join(home, 'config.toml'), 'utf8')
    assert.match(config, /mcp_servers.other/)
    assert.doesNotMatch(config, /mcp_servers.fitbay_music/)
    // Multiple clients use explicit selection. Preserve existing services and later user edits.
    const dir = path.join(appData, 'Claude')
    await mkdir(dir)
    const file = path.join(dir, 'claude_desktop_config.json')
    const initial = { theme: 'dark', mcpServers: { other: { command: 'example' } } }
    await writeFile(file, JSON.stringify(initial))
    await expect(page.getByRole('status')).toContainText('Claude Desktop', { timeout: 8000 })
    await toggle.click()
    await page.getByRole('button', { name: 'Claude Desktop', exact: true }).click()
    await expect(toggle).toBeChecked()
    let json = JSON.parse(await readFile(file))
    assert.deepEqual(json.mcpServers.other, initial.mcpServers.other)
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    assert.deepEqual(JSON.parse(await readFile(file)), initial)
    await toggle.click()
    await page.getByRole('button', { name: 'Claude Desktop', exact: true }).click()
    await expect(toggle).toBeChecked()
    json = JSON.parse(await readFile(file))
    json.mcpServers.fitbay_music.userEdited = true
    await writeFile(file, JSON.stringify(json))
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    assert.deepEqual(JSON.parse(await readFile(file)), json)
    await toggle.click()
    await page.getByRole('button', { name: 'Claude Desktop', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('同名服务已存在')
    await expect(toggle).not.toBeChecked()
    assert.deepEqual(JSON.parse(await readFile(file)), json)
  } finally {
    proc?.stdin.end()
    await app.close()
  }
}

await run(async (call) => {
  const lists = await call('list_playlists', { offset: 0 })
  assert.equal(lists.find((p) => p.name === '通勤').id, commute)
  const recent = await call('recent_tracks', { offset: 0 })
  assert.equal(recent[1].title, '上一首')
  await call('add_to_playlist', { playlist: commute, tracks: [recent[1].id] })
  assert.ok(
    (await call('compare_playlists', { left: commute, right: commute, offset: 0 })).some(
      (row) => row.id === recent[1].id,
    ),
  )
  const rows = await call('search_library', { query: '短片', offset: 0 })
  assert.equal(rows.length, 3)
  const chosen = ['片头', '片尾'].map((s) => rows.find((t) => t.title === s).id)
  const created = await call('create_listening_playlist', { name: '视频初剪', tracks: chosen })
  assert.deepEqual(
    (
      await call('compare_playlists', {
        left: created.playlist,
        right: created.playlist,
        offset: 0,
      })
    ).map((t) => t.title),
    ['片头', '片尾'],
  )
  const common = await call('compare_playlists', { left: commute, right: release, offset: 0 })
  assert.equal(common.length, 1)
  assert.equal(common[0].id, online)
  assert.equal(common[0].origin, 'online')
  for (const result of [recent, rows, common])
    assert.doesNotMatch(JSON.stringify(result), /file:|[A-Z]:\\|https?:/i)
})
console.log('PASS 独立 Codex 真实连接、三项任务、单客户端直连、多客户端选择与安全撤销', profile)
