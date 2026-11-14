import { openDiscovery } from './discovery-fixture.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'
import { openMusicSettings } from './music-settings-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/music-task-panel-'))
const profile = path.join(root, 'profile'),
  dir = path.join(root, 'saved')
await mkdir(dir)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const tone = path.resolve('tests/fixtures/local-music/tone.mp3')
store.set('music-guide-v1', 1)
store.set('music-media-keys', 'off')
store.set('music-manual-dir', dir)
store.set('draft', '上次保存的草稿')
store.set('music-recommend-dir', dir)
store.library.upsert({
  file: tone,
  title: '晨光',
  artist: '林声',
  album: '不传给推荐的专辑',
  duration: 4,
})
const old = store.saveSuggestions('已有批次', [], '待处理', undefined, 5)
store.db
  .prepare("UPDATE recommendation_runs SET state='completed',message='原有批次' WHERE batch=?")
  .run(old)
store.db.close()
const source = path.join(root, 'source.js')
await writeFile(
  source,
  `// @name 真人操作夹具
lx.on('request',({action})=>action==='search'?[{id:'online-track',name:'山风',singer:'清河',allowPermanentSave:true}]:'https://1.1.1.1/test-song.mp3');
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k'],allowPermanentSave:true}}})`,
)
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await offlineSourceRepository(app)
  await app.evaluate(
    ({ dialog }, { source, tone }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
      const https = process.getBuiltinModule('node:https'),
        fs = process.getBuiltinModule('node:fs')
      const { EventEmitter } = process.getBuiltinModule('node:events'),
        original = https.request
      https.request = (url, options, done) => {
        if (url.pathname !== '/test-song.mp3') return original(url, options, done)
        const req = new EventEmitter()
        req.end = () => {
          globalThis.finishTestDownload = () => {
            if (options.signal.aborted) throw Error('切页错误取消了下载')
            done(
              Object.assign(fs.createReadStream(tone), {
                statusCode: 200,
                headers: { 'content-type': 'audio/mpeg' },
                setTimeout() {},
              }),
            )
          }
        }
        return req
      }
      globalThis.testModelCalls = []
      globalThis.fetch = async (_url, options) => {
        globalThis.testModelCalls.push(JSON.parse(options.body))
        return new Promise((_, reject) =>
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          }),
        )
      }
    },
    { source, tone },
  )
  await page.evaluate(async () => {
    await window.music.lxImport()
    const { models } = await window.music.state()
    const provider = models.providers.find((p) => p.id === models.active)
    await window.music.configureModel(provider.id, provider.model, 'isolated-test-key', false)
  })
  await page.reload()
  const tab = (name) => page.getByRole('tab', { name, exact: true }).evaluate((b) => b.click())
  const button = (name) => page.getByRole('button', { name, exact: true })
  const press = (name) => button(name).evaluate((b) => b.click())
  const panel = page.locator('.download-tasks')
  await openDiscovery(page, true)
  await expect(button('以当前歌曲为参考')).toBeDisabled()
  await tab('曲库')
  await press('播放晨光')
  await expect.poll(() => page.locator('audio').evaluate((a) => !a.paused)).toBe(true)
  await openDiscovery(page, true)
  const description = page.getByLabel('想让 AI 推荐什么？（选填）')
  await expect(description).toHaveValue('上次保存的草稿')
  await expect(page.getByLabel('推荐首数')).toHaveValue('5')
  await description.fill('草稿')
  await page.getByLabel('推荐首数').fill('3')
  await press('以《晨光》为参考')
  await expect(description).toHaveValue('晨光 · 林声')
  await expect(description).toBeFocused()
  await description.fill('晨光 · 林声，想听木吉他')
  for (const destination of ['歌手', '歌手']) {
    await tab(destination)
    await openDiscovery(page, true)
    await expect(description).toHaveValue('晨光 · 林声，想听木吉他')
    await expect(page.getByLabel('推荐首数')).toHaveValue('3')
  }
  await expect(page.getByLabel('推荐首数')).toHaveValue('3')
  assert.equal(await app.evaluate(() => globalThis.testModelCalls.length), 0)
  assert.equal(await page.evaluate(async () => (await window.music.state()).batches[0].id), old)
  await press('生成推荐')
  await expect.poll(() => app.evaluate(() => globalThis.testModelCalls.length)).toBeGreaterThan(0)
  assert.ok(
    JSON.stringify(await app.evaluate(() => globalThis.testModelCalls)).includes('想听木吉他'),
  )
  await tab('歌手')
  await press('下载任务')
  await expect(panel).toContainText('已下载 0/3 首')
  await page.keyboard.press('Escape')
  await openDiscovery(page, true)
  await press('终止本次推荐')
  await expect(button('生成推荐')).toBeEnabled()
  await openDiscovery(page, false)
  const input = page.getByRole('textbox', { name: '搜索关键词' })
  await input.fill('山风')
  await input.press('Enter')
  await page
    .getByRole('listitem')
    .filter({ hasText: '山风' })
    .getByRole('button', { name: '下载', exact: true })
    .evaluate((b) => b.click())
  await expect.poll(() => app.evaluate(() => typeof globalThis.finishTestDownload)).toBe('function')
  await tab('歌单')
  await press('下载任务')
  await expect(panel).toContainText('山风 · 清河')
  await expect(panel).toContainText('下载中')
  await app.evaluate(() => globalThis.finishTestDownload())
  await expect(panel).toContainText('已入库')
  assert.equal((await readdir(dir)).filter((name) => name.endsWith('.mp3')).length, 1)
  await page.keyboard.press('Escape')
  await tab('曲库')
  await press('最近入库')
  const titles = page.locator('.library-row .library-name strong')
  const downloaded = await page.evaluate(async () =>
    (await window.music.state()).localTracks.find((track) => track.origin === 'download'),
  )
  assert.ok(downloaded)
  await expect(titles).toHaveText([downloaded.title, '晨光'])
  const captureOrder = (file) =>
    page.screenshot({
      path: path.join(root, file),
      style: ':root {background:var(--base) !important}',
    })
  await captureOrder('new-download-order.png')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, path.resolve('tests/fixtures/local-music/tone.flac'))
  await openMusicSettings(page)
  await press('添加文件')
  await tab('曲库')
  await expect(titles).toHaveCount(3)
  const imported = await page.evaluate(async () =>
    (await window.music.state()).localTracks.find(
      (track) => track.origin === 'local' && track.title !== '晨光',
    ),
  )
  assert.ok(imported)
  await expect(titles).toHaveText([imported.title, downloaded.title, '晨光'])
  await captureOrder('new-import-order.png')
  await press('最近入库')
  await expect(button('最近入库')).toHaveAttribute('aria-pressed', 'false')
  await press('下载任务')
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'download-tasks.png') })
  console.log(
    'PASS 使用当前歌曲仅填可编辑草稿，生成前零模型调用；跨五项导航查看实际推荐与下载状态，切页下载入库',
    root,
  )
} finally {
  await app.close()
}
