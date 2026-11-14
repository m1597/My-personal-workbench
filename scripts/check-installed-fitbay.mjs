import { checkDefaultCatalog } from './public-music-plugin-fixture.mjs'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { dragMusicIn, dragMusicOut } from './music-drag-fixture.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

// Called by check-separate-installers.ps1 only after checking the real installer registrations.
const [scenario, root] = process.argv.slice(2)
assert.ok(
  path.isAbsolute(root) &&
    ['workbench', 'music', 'music-survivor', 'workbench-first', 'music-first'].includes(scenario),
)
const w = path.join(root, 'Workbench', 'FitBay.exe')
const m = path.join(root, 'Music', 'FitBay Music.exe')
const profile = path.join(root, 'profiles', scenario === 'music-survivor' ? 'music' : scenario)
const args = [`--user-data-dir=${profile}`, '--mute-audio']
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' }
delete env.ELECTRON_RUN_AS_NODE
const first = scenario.startsWith('workbench') ? w : m
const app = await electron.launch({ executablePath: first, args, env, timeout: 45000 })
const find = async (fragment) => {
  await expect
    .poll(() => app.windows().some((p) => p.url().includes(fragment)), { timeout: 15000 })
    .toBe(true)
  return app.windows().find((p) => p.url().includes(fragment))
}
const launchOther = (exe) =>
  promisify(execFile)(exe, args, { env, timeout: 20000, windowsHide: true })
async function checkInstalledMcp() {
  const script = path.join(path.dirname(m), 'resources/app/scripts/music-source-mcp.mjs')
  const child = spawn(process.execPath, [script, profile], {
    cwd: root,
    windowsHide: true,
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const send = (request) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...request })}\n`)
  async function response(id) {
    const line = await lines.next()
    assert.ok(!line.done, 'Installed MCP process stopped before responding')
    const reply = JSON.parse(line.value)
    assert.equal(reply.id, id)
    assert.ok(reply.result, JSON.stringify(reply.error))
    return reply.result
  }
  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'fitbay-acceptance', version: '1' },
      },
    })
    assert.equal((await response(1)).serverInfo.name, 'fitbay-music-sources')
    send({ method: 'notifications/initialized' })
    send({ id: 2, method: 'tools/call', params: { name: 'list_sources', arguments: {} } })
    const result = await response(2)
    assert.ok(!result.isError, result.content[0].text)
    assert.ok(Array.isArray(JSON.parse(result.content[0].text).catalog))
    console.log('PASS 安装版 MCP 通过独立 profile 读取运行中 Music 的音源目录')
  } finally {
    child.stdin.end()
    await lines.return()
  }
}
async function listen(player) {
  const skip = player.getByRole('button', { name: '跳过', exact: true })
  if (await skip.isVisible()) await skip.click()
  await player.getByRole('tab', { name: '曲库', exact: true }).click()
  const file = path.join(root, '安装测试音频.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await openMusicSettings(player)
  await selectMusicSettings(player, '本地曲库')
  await player.getByRole('button', { name: '添加文件', exact: true }).click()
  await player.getByRole('tab', { name: '曲库', exact: true }).click()
  await player.getByRole('button', { name: '播放安装测试音频', exact: true }).click()
  await expect
    .poll(() => player.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.2))
    .toBe(true)
}
try {
  const actual = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    profile: app.getPath('userData'),
    mute: app.commandLine.hasSwitch('mute-audio'),
  }))
  assert.deepEqual(actual, { packaged: true, profile, mute: true })
  if (scenario === 'music-survivor') {
    await assert.rejects(access(w), { code: 'ENOENT' })
    const music = await find('/music/index.html')
    await listen(music)
    await checkDefaultCatalog(music)
    console.log('PASS 卸载工作台后，Music 仍可播放')
  } else if (scenario === 'workbench') {
    await assert.rejects(access(m), { code: 'ENOENT' })
    const shell = await find('/workbench/index.html')
    await expect(shell.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(0)
    await shell.getByRole('button', { name: '窗口', exact: true }).click()
    await shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
    await expect(
      shell.getByRole('alert').filter({ hasText: '请先安装 FitBay Music' }),
    ).toBeVisible()
    await expect(shell.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(0)
    console.log('PASS 仅安装工作台，空工作区可独立启动')
  } else if (scenario === 'music') {
    await assert.rejects(access(w), { code: 'ENOENT' })
    const music = await find('/music/index.html')
    await listen(music)
    await checkInstalledMcp()
    await checkDefaultCatalog(music)
    await expect(music.getByRole('button', { name: '使用引导' })).toBeVisible()
    // Off-screen Chromium screenshots omit the native acrylic composition.
    await music.evaluate(() => delete document.documentElement.dataset.backdrop)
    await music.screenshot({ path: path.join(root, 'installed-music.png') })
    console.log(
      'PASS 仅安装 Music，真实 WAV 导入与静音播放、引导与三个公开插件与本地路径插件默认未安装',
    )
  } else {
    let shell, player
    if (scenario === 'music-first') {
      player = await find('/music/index.html')
      await listen(player)
      await launchOther(w)
      shell = await find('/workbench/index.html')
    } else {
      shell = await find('/workbench/index.html')
      await shell.getByRole('button', { name: '窗口', exact: true }).click()
      await shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
      player = await find('/music/index.html')
      await expect(shell.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
      await listen(player)
      await launchOther(m)
    }
    await player.evaluate(() => {
      window.fitbayInstalledAudio = document.querySelector('audio')
    })
    const docked = shell.getByRole('tab', { name: 'Music', exact: true })
    if (!(await docked.isVisible())) await dragMusicIn(app, shell)
    await expect(player.locator('[data-surface="embedded"]')).toBeVisible()
    await dragMusicOut(app, shell)
    await expect(player.locator('[data-surface="window"]')).toBeVisible()
    assert.ok(
      await player.evaluate(() => window.fitbayInstalledAudio === document.querySelector('audio')),
    )
    const before = await player.locator('audio').evaluate((a) => a.currentTime)
    await expect
      .poll(() => player.locator('audio').evaluate((a) => a.currentTime))
      .toBeGreaterThan(before + 0.05)
    console.log(`PASS 同装双入口、原视图停靠/分离、静音播放时钟继续：${scenario}`)
  }
} finally {
  await app.close()
}
