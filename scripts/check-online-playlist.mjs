import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/online-playlist-'))
const profile = path.join(root, 'profile')
const file = path.join(root, 'source.js')
const tone = path.join(root, 'local.wav')
const { recording } = await import('../components/music/offline-source.mjs')
await writeFile(tone, recording('fitbay-tone-1'))
await writeFile(
  file,
  `// @name 在线歌单夹具
lx.on('request',({action})=>action==='search' ? [{name:'测试在线歌曲',singer:'艺人',id:'persistent',durationSeconds:20}] :
  'https://1.1.1.1/online-tone.wav?session='+Date.now());
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const list = store.library.createPlaylist('混合歌单')
store.library.upsert({
  file: tone,
  title: '本地歌曲',
  artist: '艺人',
  album: '',
  duration: 20,
})
const local = store.library.list()[0].id
store.db.close()

let previousGrant, onlineId
for (const restart of [false, true]) {
  const app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  try {
    await offlineSourceRepository(app)
    await app.evaluate(
      ({ dialog }, { file, tone }) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
        const https = process.getBuiltinModule('node:https')
        const fs = process.getBuiltinModule('node:fs')
        const { EventEmitter } = process.getBuiltinModule('node:events')
        const original = https.request
        https.request = (url, options, done) => {
          if (url.pathname !== '/online-tone.wav') return original(url, options, done)
          const request = new EventEmitter()
          request.end = () =>
            done(
              Object.assign(fs.createReadStream(tone), {
                statusCode: 200,
                headers: {
                  'content-length': String(fs.statSync(tone).size),
                  'content-type': 'audio/wav',
                },
                setTimeout() {},
              }),
            )
          return request
        }
      },
      { file, tone },
    )
    const page = await app.firstWindow()
    const button = (name) => page.getByRole('button', { name, exact: true })
    const audio = page.locator('audio')
    if (!restart) {
      await button('跳过').click()
      await page.evaluate(() => window.music.lxImport())
      await page.getByRole('tab', { name: '搜索音乐' }).click()
      const pane = page.getByRole('region', { name: '搜索音乐' })
      await pane.getByRole('textbox').fill('测试在线歌曲')
      await pane.getByRole('textbox').press('Enter')
      await pane.getByRole('button', { name: '加入歌单' }).click()
      await page.getByRole('menuitem', { name: '混合歌单' }).click()
      await expect(pane.getByText('已加入「混合歌单」')).toBeVisible()
      await page.evaluate(
        ([list, local]) => window.music.setMembership(list, local, true),
        [list, local],
      )
      await pane.getByRole('button', { name: '播放', exact: true }).click()
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      onlineId = await page.evaluate(async () => (await window.music.state()).current)
      assert.match(onlineId, /^online-recording-[a-f0-9]{64}$/)
      previousGrant = await audio.evaluate((a) => a.src)
      await audio.evaluate((a) => {
        a.currentTime = 3
      })
      await button('暂停').click()
      await expect.poll(() => audio.evaluate((a) => a.paused && !a.getAttribute('src'))).toBe(true)
      await expect
        .poll(() => page.evaluate(async () => (await window.music.state()).position))
        .toBeGreaterThanOrEqual(3)
    } else {
      const state = await page.evaluate(() => window.music.state())
      assert.equal(state.current, onlineId)
      assert.deepEqual(
        state.localTracks.map((t) => t.id),
        [local],
      )
      assert.deepEqual(state.playlists.find((p) => p.id === list).tracks, [onlineId, local])
      await button('曲库导航').click()
      await button('混合歌单').click()
      await expect(page.locator('.library-row')).toHaveCount(2)
      await expect(page.locator('.library-row').first().getByText('在线录音')).toBeVisible()
      await button('播放测试在线歌曲').click()
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime >= 3)).toBe(true)
      assert.notEqual(await audio.evaluate((a) => a.src), previousGrant)
      await button('暂停').click()
      await expect.poll(() => audio.evaluate((a) => !a.getAttribute('src'))).toBe(true)
      await button('播放测试在线歌曲').click()
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime >= 3)).toBe(true)
      await button('下一首').click()
      await expect(page.locator('.music-transport strong')).toHaveText('本地歌曲')
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      await button('上一首').click()
      await expect(page.locator('.music-transport strong')).toHaveText('测试在线歌曲')
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      // Headless screenshots cannot capture the native window backdrop.
      await page.evaluate(() => {
        delete document.documentElement.dataset.backdrop
      })
      await page.screenshot({ path: path.join(root, 'mixed-playlist.png') })
    }
  } finally {
    await app.close()
  }
}
console.log('PASS 在线录音加入歌单、暂停释放、重启重新取址恢复进度、本地与在线切换', root)
