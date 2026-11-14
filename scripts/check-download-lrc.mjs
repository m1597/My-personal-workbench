import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { MusicStore } from '../components/music/store.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'
const root = await mkdtemp(path.resolve('tmp/music-download-lrc-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.db.close()
const source = path.join(root, 'fixture.js')
await writeFile(
  source,
  `// @name LRC 夹具
lx.on('request',({action,info})=>{
 if(action==='search') return [{name:info.keyword,singer:'艺人',id:info.keyword}]
 if(action==='lyric') return {lyric:'[00:00.00]Song',tlyric:'[00:00.00]译文'}
 return 'https://1.1.1.1/test-audio.mp3'
});lx.send('inited',{sources:{wy:{actions:['search','musicUrl','lyric'],qualitys:['320k']}}})`,
)
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const page = app.windows().find((p) => p.url().includes('/music/index.html'))
  const select = (filename) =>
    app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
    }, filename)
  await select(source)
  await page.evaluate(() => window.music.lxImport())
  await openMusicSettings(page)
  await selectMusicSettings(page, '下载')
  const save = page.getByLabel('同时保存同名 LRC 歌词文件')
  const translate = page.getByLabel('有译文时同时保存译文')
  await expect(save).toBeChecked()
  await expect(translate).not.toBeChecked()
  let basename
  for (const mode of ['原文', '双语', '关闭', '保留']) {
    if (mode === '双语') {
      await translate.check()
      await expect
        .poll(() => page.evaluate(async () => (await window.music.state()).prefs.lrcLanguage))
        .toBe('bilingual')
    }
    if (mode === '关闭') {
      await save.uncheck()
      await expect(translate).toBeDisabled()
      await expect
        .poll(() => page.evaluate(async () => (await window.music.state()).prefs.lrcSave))
        .toBe('off')
    }
    const dir = path.join(root, mode)
    await mkdir(dir)
    if (mode === '保留') await writeFile(path.join(dir, basename + '.lrc'), '我的文件')
    await select(dir)
    await page.evaluate(() => window.music.chooseMusicDirectory('manual'))
    const key = await page.evaluate(
      async () =>
        (await window.music.lxSearch({ title: '录音', artist: '艺人' }, 'wy')).items[0].key,
    )
    await app.evaluate((_, f) => {
      const https = process.getBuiltinModule('node:https'),
        fs = process.getBuiltinModule('node:fs'),
        { EventEmitter } = process.getBuiltinModule('node:events')
      const original = https.request
      https.request = (url, opts, done) => {
        if (url.href !== 'https://1.1.1.1/test-audio.mp3') return original(url, opts, done)
        https.request = original
        const req = new EventEmitter()
        req.end = () =>
          done(
            Object.assign(fs.createReadStream(f), {
              statusCode: 200,
              headers: {},
              setTimeout() {},
            }),
          )
        return req
      }
    }, path.resolve('tests/fixtures/local-music/tone.mp3'))
    await page.evaluate((key) => window.music.lxDownload(key, '320k', true), key)
    const files = await readdir(dir)
    basename = path.parse(files.find((f) => f.endsWith('.mp3'))).name
    if (mode === '关闭') assert.deepEqual(files, [basename + '.mp3'])
    else
      assert.equal(
        await readFile(path.join(dir, basename + '.lrc'), 'utf8'),
        mode === '原文'
          ? '[00:00.00]Song'
          : mode === '双语'
            ? '[00:00.000]Song\r\n[00:00.000]译文\r\n'
            : '我的文件',
      )
    if (mode === '双语')
      await page.screenshot({
        path: path.join(root, '下载歌词.png'),
        style: ':root{background:var(--base)!important}',
      })
  }
  console.log('PASS Music 实际下载文件、默认原文、附译文、关闭和已有文件保护', root)
} finally {
  await app.close()
}
