import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/online-playlist-'))
const profile = path.join(root, 'profile')
const file = path.join(root, 'source.js')
const tone = path.join(root, 'local.wav')
const { recording } = await import('../components/music/offline-source.mjs')
await writeFile(tone, recording('fitbay-tone-1'))
const digest = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
const originalDigest = await digest(tone)
const downloadDir = path.join(root, 'downloads')
await mkdir(downloadDir)
const conflict = path.join(downloadDir, '艺人 - 文件冲突.wav')
await writeFile(conflict, recording('fitbay-tone-1'))
const conflictDigest = await digest(conflict)
await writeFile(
  file,
  `// @name 在线歌单夹具
lx.on('request',({action,info})=>action==='search' ? (info.keyword==='混选夹具' ?
  ['另存在线','文件冲突','未选在线'].map(name=>({name,singer:'艺人',id:name,allowPermanentSave:true})) :
  [{name:'测试在线歌曲',singer:'艺人',id:'persistent',durationSeconds:20}]) :
  action==='lyric' ? null : 'https://1.1.1.1/online-tone.wav?recording='+encodeURIComponent(info.musicInfo.id)+'&quality='+info.type+'&session='+Date.now());
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k','128k']}}})`,
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
store.set('music-manual-dir', downloadDir)
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
          globalThis.mixedAudioRequests?.push(url.searchParams.get('recording'))
          globalThis.testOnlineQuality = url.searchParams.get('quality')
          const request = new EventEmitter()
          if (globalThis.delayOnlineRecording) {
            request.end = () => {
              globalThis.delayOnlineRecording = 'waiting'
              options.signal.addEventListener(
                'abort',
                () => {
                  globalThis.delayOnlineRecording = 'aborted'
                  request.emit('error', options.signal.reason)
                },
                { once: true },
              )
            }
            return request
          }
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
      await page.getByRole('tab', { name: '在线找歌' }).click()
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
      const nextQuality = await app.evaluate(() =>
        globalThis.testOnlineQuality === '320k' ? '128k' : '320k',
      )
      await openMusicSettings(page)
      await selectMusicSettings(page, '下载')
      await page.getByRole('combobox', { name: '试听音质' }).click()
      await page.getByRole('option', { name: nextQuality, exact: true }).click()
      await page.getByRole('tab', { name: '在线找歌' }).click()
      await pane.getByRole('textbox').fill('测试在线歌曲')
      await pane.getByRole('textbox').press('Enter')
      await pane.getByRole('button', { name: '播放', exact: true }).click()
      await expect.poll(() => app.evaluate(() => globalThis.testOnlineQuality)).toBe(nextQuality)
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      assert.notEqual(await audio.evaluate((a) => a.src), previousGrant)
      assert.equal(await page.evaluate(async () => (await window.music.state()).current), onlineId)
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
      await page.getByRole('tab', { name: '歌单', exact: true }).click()
      await button('歌单导航').click()
      await button('混合歌单').click()
      await expect(page.locator('.library-row')).toHaveCount(2)
      await expect(
        page.locator('.library-row').first().getByText('在线', { exact: true }),
      ).toBeVisible()
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
      await button('暂停').click()
      await expect.poll(() => audio.evaluate((a) => !a.getAttribute('src'))).toBe(true)
      await app.evaluate(() => {
        globalThis.delayOnlineRecording = true
      })
      await button('播放测试在线歌曲').click()
      await expect.poll(() => app.evaluate(() => globalThis.delayOnlineRecording)).toBe('waiting')
      await button('下一首').click()
      await expect.poll(() => app.evaluate(() => globalThis.delayOnlineRecording)).toBe('aborted')
      await expect(page.locator('.music-transport strong')).toHaveText('本地歌曲')
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      await app.evaluate(() => {
        globalThis.delayOnlineRecording = false
      })
      const extra = await page.evaluate(async (list) => {
        const found = await window.music.lxSearch({ title: '混选夹具', artist: '' }, 'wy')
        const ids = []
        for (const row of found.items) ids.push(await window.music.rememberOnline(row.key))
        await window.music.setMembership(list, ids, true)
        return ids
      }, list)
      assert.equal(extra.length, 3)
      await page.getByRole('tab', { name: '在线找歌' }).click()
      await page.getByRole('tab', { name: '歌单' }).click()
      const rows = page.locator('.library-row')
      await expect(rows).toHaveCount(5)
      await button('多选').click()
      await page.getByRole('checkbox', { name: '选择本地歌曲' }).check()
      await expect(button('下载所选')).toBeDisabled()
      for (const name of ['另存在线', '文件冲突'])
        await page.getByRole('checkbox', { name: '选择' + name }).check()
      const labels = () =>
        rows.evaluateAll((elements) =>
          elements.map((row) => ({
            title: row.querySelector('.library-name strong').textContent,
            location: row.querySelector('.library-track-location').textContent,
          })),
        )
      const beforeLabels = await labels()
      const beforeFiles = await readdir(downloadDir)
      assert.equal(beforeLabels.filter((row) => row.location === '本地').length, 1)
      assert.deepEqual(beforeFiles, ['艺人 - 文件冲突.wav'])
      await app.evaluate(() => {
        globalThis.mixedAudioRequests = []
      })
      await button('下载所选').click()
      await expect(page.getByText('已下载 1 首 · 已跳过 1 首 · 失败 1 首')).toBeVisible()
      const selectedRow = (name) => rows.filter({ has: page.getByText(name, { exact: true }) })
      await expect(selectedRow('另存在线').getByText('本地', { exact: true })).toBeVisible()
      await expect(selectedRow('文件冲突').getByText(/下载失败/)).toBeVisible()
      await expect(selectedRow('未选在线').getByText('在线', { exact: true })).toBeVisible()
      const requests = await app.evaluate(() => globalThis.mixedAudioRequests)
      assert.ok(requests.includes('另存在线'))
      assert.ok(requests.every((id) => ['另存在线', '文件冲突'].includes(id)))
      await writeFile(
        path.join(root, '混选验收.json'),
        JSON.stringify(
          {
            selected: ['本地歌曲', '另存在线', '文件冲突'],
            beforeLabels,
            afterLabels: await labels(),
            beforeFiles,
            afterFiles: await readdir(downloadDir),
            audioRequests: requests,
            localOriginal: { before: originalDigest, after: await digest(tone) },
            conflictOriginal: { before: conflictDigest, after: await digest(conflict) },
          },
          null,
          2,
        ),
      )
      const audit = await page.evaluate(() => window.music.state())
      assert.equal(audit.localTracks.length, 2)
      assert.equal(
        audit.onlineTracks.find((r) => r.id === extra[0]).localCopy,
        audit.localTracks.find((r) => r.id !== local).id,
      )
      assert.equal(audit.onlineTracks.find((r) => r.id === extra[1]).localCopy, null)
      assert.equal(audit.onlineTracks.find((r) => r.id === extra[2]).localCopy, null)
      assert.deepEqual(audit.playlists.find((p) => p.id === list).tracks, [
        onlineId,
        local,
        ...extra,
      ])
      assert.deepEqual(
        (await readdir(downloadDir)).sort(),
        ['艺人 - 另存在线.wav', '艺人 - 文件冲突.wav'].sort(),
      )
      assert.equal(await digest(tone), originalDigest)
      assert.equal(await digest(conflict), conflictDigest)
      for (const name of ['文件冲突', '本地歌曲'])
        await page.getByRole('checkbox', { name: '选择' + name }).uncheck()
      await expect(button('下载所选')).toBeDisabled()
      for (const name of ['文件冲突', '本地歌曲'])
        await page.getByRole('checkbox', { name: '选择' + name }).check()
      await page.screenshot({
        path: path.join(root, 'mixed-download.png'),
        style: ':root { background: var(--base) !important }',
      })
      await button('退出多选').click()
      await app.evaluate(() => {
        globalThis.delayOnlineRecording = 'block network'
      })
      await button('播放另存在线').click()
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      assert.equal(await app.evaluate(() => globalThis.delayOnlineRecording), 'block network')
      // A missing indexed file still owns its path. Retrying must preserve its metadata.
      await app.evaluate(() => {
        globalThis.delayOnlineRecording = false
      })
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      }, conflict)
      await page.evaluate(() => window.music.importLocal('files'))
      await expect
        .poll(() => page.evaluate(async () => (await window.music.state()).localTracks.length))
        .toBe(3)
      const before = await page.evaluate(async () =>
        (await window.music.state()).localTracks.map(({ id, title, artist }) => ({
          id,
          title,
          artist,
        })),
      )
      await unlink(conflict)
      await button('多选').click()
      await page.getByRole('checkbox', { name: '选择文件冲突' }).check()
      await button('下载所选').click()
      await expect(selectedRow('文件冲突').getByText(/目标路径已有曲库记录/)).toBeVisible()
      assert.deepEqual(
        await page.evaluate(async () =>
          (await window.music.state()).localTracks.map(({ id, title, artist }) => ({
            id,
            title,
            artist,
          })),
        ),
        before,
      )
      assert.deepEqual(await readdir(downloadDir), ['艺人 - 另存在线.wav'])
      await page.getByRole('checkbox', { name: '全选当前列表' }).check()
      await expect(page.getByText('已选 5 首')).toBeVisible()
      await app.evaluate(() => {
        globalThis.mixedAudioRequests = []
      })
      await button('下载所选').click()
      await expect(page.getByText(/已下载 .*已跳过 2 首/)).toBeVisible()
      const allRequests = await app.evaluate(() => globalThis.mixedAudioRequests)
      assert.ok(allRequests.includes('未选在线'))
      assert.ok(!allRequests.includes('另存在线'))
      assert.equal(await digest(tone), originalDigest)
    }
  } finally {
    await app.close()
  }
}
console.log(
  'PASS 在线录音重启、切歌、混选下载、原行转本地及离线播放、未选与已有文件数量及 SHA-256',
  root,
)
