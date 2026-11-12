import { spawnSync } from 'node:child_process'
import electronBin from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { runSource } from '../examples/component-host/lx-runtime.mjs'
import { openPublic } from '../examples/component-host/lx-net.mjs'
import { MusicStore } from '../components/music/store.mjs'

for (const addr of ['http://127.0.0.1', 'http://[::1]', 'http://169.254.169.254', 'file:///tmp/a'])
  await assert.rejects(openPublic(addr))
const guest =
  "lx.on('request',()=>[typeof process, typeof require,typeof fetch]);lx.send('inited',{sources:{wy:{}}})"
assert.deepEqual(await runSource(guest, { action: 'test' }), [
  'undefined',
  'undefined',
  'undefined',
])
await assert.rejects(runSource('while(true){}'))
console.log('PASS 源隔离、超时及网络范围')
await fs.mkdir('tmp', { recursive: true })
const testProfile = await fs.mkdtemp(path.resolve('tmp/lx-decode-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const decode = spawnSync(
  electronBin,
  ['scripts/check-lx-audio.mjs', '--user-data-dir=' + testProfile],
  {
    env,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  },
)
assert.equal(decode.status, 0, decode.stderr || decode.error?.message)
console.log(decode.stdout.trim())
const live = process.argv.includes('--live')
const root = await fs.mkdtemp(path.resolve('tmp/lx-check-')),
  profile = path.join(root, 'profile')
const output = path.join(root, 'downloads')
await fs.mkdir(output)
let row = { title: '离线测试', artist: '测试艺人', album: '测试专辑' }
let sourceFile = path.join(root, 'test-source.js')
if (live) {
  sourceFile = path.resolve(process.env.FITBAY_LX_TEST_SOURCE)
  const original = new DatabaseSync('local/desktop-profile/fitbay-music/music.sqlite', {
    readOnly: true,
  })
  row = original
    .prepare(
      "SELECT title,artist,album FROM local_tracks WHERE artist!='未知艺人' AND length(title)<16 AND (? IS NULL OR title=?) LIMIT 1",
    )
    .get(process.env.FITBAY_LX_TEST_TITLE ?? null, process.env.FITBAY_LX_TEST_TITLE ?? null)
  original.close()
} else {
  await fs.writeFile(
    sourceFile,
    `// @name FitBay 测试源
 lx.on('request',async ({action,info})=>{
  if(action==='search'){
   await new Promise(done=>setTimeout(done,600))
   return [
     {name:info.keyword,singer:'测试艺人',albumName:'测试专辑',id:'test'},
     {name:'可下载版本',singer:'测试艺人',albumName:'音频夹具',id:'audio'}
   ]
  }
  return info.musicInfo.id === 'audio' ? 'https://1.1.1.1/test-audio.mp3' : 'http://127.0.0.1/forbidden'
 })
 lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
}
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.library.upsert({
  ...row,
  duration: 20,
  file: path.resolve('tests/fixtures/local-music/tone.mp3'),
})
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
const choose = (file) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, file)
try {
  const page = await app.firstWindow()
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(3)
  for (const [index, name] of ['本地曲库', '下载音乐', '每日推荐'].entries())
    await expect(tabs.nth(index)).toHaveAccessibleName(name)
  await expect(page.getByRole('button', { name: /音乐源|查找版本/ })).toHaveCount(0)
  await page.getByRole('tab', { name: '下载音乐' }).click()
  await choose(sourceFile)
  await page.getByRole('button', { name: '本地导入' }).click()
  await expect.poll(() => page.evaluate(() => window.music.lxInfo())).not.toBe('')
  const savedName = await page.evaluate(() => window.music.lxInfo())
  await page.getByRole('button', { name: '在线导入' }).click()
  await page.getByLabel('音乐源链接').fill('http://127.0.0.1/source.js')
  await page.getByRole('button', { name: '导入链接' }).click()
  await expect(page.getByText(/仅支持公网地址/)).toBeVisible()
  assert.equal(await page.evaluate(() => window.music.lxInfo()), savedName)
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'import.png') })
  if (!live) {
    const code = (await fs.readFile(sourceFile, 'utf8')).replace(/@name [^\n]+/, '@name 在线测试源')
    await app.evaluate((_electron, code) => {
      const https = process.getBuiltinModule('node:https')
      const { Readable } = process.getBuiltinModule('node:stream')
      const { EventEmitter } = process.getBuiltinModule('node:events')
      const original = https.request
      https.request = (url, _options, done) => {
        https.request = original
        if (url.href !== 'https://1.1.1.1/test-source.js') throw Error('测试地址不匹配')
        const req = new EventEmitter()
        req.end = () =>
          done(Object.assign(Readable.from([Buffer.from(code)]), { statusCode: 200, headers: {} }))
        return req
      }
    }, code)
    await page.getByLabel('音乐源链接').fill('https://1.1.1.1/test-source.js')
    await page.getByRole('button', { name: '导入链接' }).click()
    await expect.poll(() => page.evaluate(() => window.music.lxInfo())).toBe('在线测试源')
  }
  const pane = page.getByRole('region', { name: '下载音乐' })
  const find = pane.getByRole('button', { name: '查找版本' })
  if (!live) {
    await pane.getByRole('textbox', { name: '歌名', exact: true }).fill('手动歌名')
    await pane.getByRole('textbox', { name: '艺人', exact: true }).fill('手动艺人')
    await find.click()
    await pane.getByRole('button', { name: '取消', exact: true }).click()
    await find.click()
    await expect(pane.getByText('手动歌名 手动艺人', { exact: true })).toBeVisible()
  }
  await pane.getByRole('combobox', { name: '从曲库选择' }).click()
  await pane.getByRole('option', { name: row.title + ' · ' + row.artist }).click()
  await expect(pane.getByRole('textbox', { name: '歌名', exact: true })).toHaveValue(row.title)
  await find.click()
  const downloads = pane.getByRole('button', { name: '下载', exact: true })
  await downloads.first().waitFor({ timeout: 65000 })
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'versions.png') })
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(400, 480),
  )
  await page.screenshot({ path: path.join(root, 'versions-small.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  // Select a candidate with matching title and artist, or report the catalogue mismatch.
  const versions = pane.locator('li')
  const labels = await versions.allTextContents()
  const index = labels.findIndex(
    (v) => v.includes(row.title) && v.includes(row.artist.split(/[、/]/)[0]),
  )
  assert.ok(index >= 0, '在线目录缺少能核对歌名、艺人的测试版本')
  await choose(output)
  await downloads.nth(index).click()
  await expect
    .poll(
      () =>
        pane
          .getByRole('status')
          .textContent()
          .catch(() => ''),
      { timeout: 180000, intervals: [500] },
    )
    .toMatch(/已下载并入库|失败|拒绝|超时|无效|不支持|未能|仅支持公网地址/)
  const status = await pane.getByRole('status').textContent()
  if (!live) {
    assert.match(status, /仅支持公网地址/)
    assert.deepEqual(await fs.readdir(output), [])
    await app.evaluate((_electron, file) => {
      const https = process.getBuiltinModule('node:https')
      const fs = process.getBuiltinModule('node:fs')
      const { EventEmitter } = process.getBuiltinModule('node:events')
      const original = https.request
      https.request = (url, _options, done) => {
        https.request = original
        if (url.href !== 'https://1.1.1.1/test-audio.mp3') throw Error('音频地址不匹配')
        const req = new EventEmitter()
        req.end = () =>
          done(
            Object.assign(fs.createReadStream(file), {
              statusCode: 200,
              headers: {},
              setTimeout() {},
            }),
          )
        return req
      }
    }, path.resolve('tests/fixtures/local-music/tone.mp3'))
    await downloads.nth(1).click()
    await expect(pane.getByText(/已下载并入库/)).toBeVisible()
    assert.equal((await fs.readdir(output)).length, 1)
    assert.equal(
      await page.evaluate(async () => (await window.music.state()).localTracks.length),
      2,
    )
    console.log(
      'PASS 三个主入口、手填和曲库搜索、源导入、取消重搜、选版本、失败清理及下载到选定目录并入库 · ' +
        root,
    )
  } else {
    if (!status.includes('已下载并入库')) throw Error(status)
    const files = await fs.readdir(output)
    assert.equal(files.length, 1)
    assert.ok((await fs.stat(path.join(output, files[0]))).size > 0)
    assert.equal(
      await page.evaluate(async () => (await window.music.state()).localTracks.length),
      2,
    )
    console.log('PASS 真实源导入、线上匹配、下载及入库。测试目录 ' + root)
  }
} finally {
  await app.close()
}
