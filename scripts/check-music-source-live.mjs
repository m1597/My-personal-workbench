import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { selectMusicSettings } from './music-settings-fixture.mjs'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'

const sdk = createRequire(path.resolve(process.env.FITBAY_TEST_SDK_DIR || '.', 'package.json'))
const dir = await mkdtemp(path.resolve('tmp/catalog-live-'))
const profile = path.join(dir, 'profile')
const output = path.join(dir, 'audio')
await mkdir(output)
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  assert.equal(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')), true)
  const player = await app.firstWindow()
  await player.waitForSelector('.music-shell')
  const localSource = path.join(dir, 'offline.js')
  await writeFile(
    localSource,
    "// @name 本地对照源\nlx.on('request',()=>null);lx.send('inited',{sources:{wy:{actions:['musicUrl'],qualitys:['128k']}}})",
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, localSource)
  await player.getByRole('tab', { name: '设置' }).click()
  await selectMusicSettings(player, '音乐源')
  await player.getByRole('button', { name: '本地导入' }).click()
  const dropdown = player.getByRole('combobox')
  await expect(dropdown).toHaveText('本地对照源')
  const { Client } = await import(
    pathToFileURL(sdk.resolve('@modelcontextprotocol/sdk/client/index.js'))
  )
  const { StdioClientTransport } = await import(
    pathToFileURL(sdk.resolve('@modelcontextprotocol/sdk/client/stdio.js'))
  )
  const client = new Client({ name: 'fitbay-acceptance', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('scripts/music-source-mcp.mjs'), profile],
    }),
  )
  try {
    const list = await client.listTools()
    console.log(
      'official SDK tools',
      list.tools.map((t) => t.name),
    )
    async function call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args })
      if (result.isError) throw Error(result.content[0].text)
      return JSON.parse(result.content[0].text)
    }
    const before = await call('list_sources')
    console.log('listed', before.catalog.length)
    const [entry] = await call('import_sources', { ids: [process.argv[2] || 'fish'] })
    console.log('import', entry)
    assert.ok(entry.id, entry.error)
    console.log('capabilities', await call('source_capabilities', { id: entry.id }))
    assert.equal((await call('list_sources')).active, before.active)
    assert.notEqual(entry.id, before.active)
    await call('select_source', { id: entry.id })
    assert.equal((await call('list_sources')).active, entry.id)
    await expect(dropdown).not.toHaveText('本地对照源')
    await call('select_source', { id: before.active })
    await expect(dropdown).toHaveText('本地对照源')
    await call('select_source', { id: entry.id })
    await expect(dropdown).not.toHaveText('本地对照源')
    console.log('保留当前、跨源切换、切回和设置自动同步通过')
    console.log('active', await player.evaluate(() => window.music.lxInfo()))
  } finally {
    await client.close()
  }

  await player.getByRole('button', { name: '音源目录' }).click()
  await expect(player.getByRole('checkbox', { name: /已导入/ })).toBeDisabled()
  await player.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await player.screenshot({ path: path.join(dir, 'catalog.png') })
  const query = { title: 'Monkeys Spinning Monkeys', artist: 'Kevin MacLeod' }
  const search = await player.evaluate((q) => window.music.lxSearch(q), query)
  console.log('检索返回', search.items.length, '音质', search.quality)
  const row = search.items.find(
    (x) =>
      x.title.toLowerCase() === query.title.toLowerCase() &&
      x.artist.toLowerCase() === query.artist.toLowerCase(),
  )
  assert.ok(row, '未找到原作者版本')
  await app.evaluate(({ dialog }, out) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [out] })
  }, output)
  const name = await player.evaluate(({ key, quality }) => window.music.lxDownload(key, quality), {
    key: row.key,
    quality: search.quality.includes('320k') ? '320k' : search.quality[0],
  })
  console.log('saved', name, (await stat(path.join(output, name))).size)
  await player.reload()
  await player.getByRole('tab', { name: '本地曲库' }).click()
  await player.getByRole('button', { name: '播放' + query.title, exact: true }).click()
  await expect
    .poll(() => player.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.25))
    .toBe(true)
  console.log(
    'played',
    await player
      .locator('audio')
      .evaluate((a) => ({ duration: a.duration, currentTime: a.currentTime })),
  )
} finally {
  console.log('evidence', dir)
  await app.close()
}
