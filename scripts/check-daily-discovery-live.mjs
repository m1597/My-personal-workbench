import assert from 'node:assert/strict'
import { DatabaseSync, backup } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { inLibrary } from '../examples/component-host/music-discovery.mjs'
import { isolateRecommendationProfile } from './isolate-recommendation-profile.mjs'

const original = path.resolve('local/desktop-profile')
const root = await fs.mkdtemp(path.resolve('tmp/daily-discovery-'))
const profile = path.join(root, 'profile')
const directory = path.join(profile, 'fitbay-music')
const output = path.join(root, '歌曲推荐')
await fs.mkdir(directory, { recursive: true })
await fs.mkdir(output)
console.log('隔离验收目录', root)
let app
let db
try {
  const source = new DatabaseSync(path.join(original, 'fitbay-music/music.sqlite'), {
    readOnly: true,
  })
  let baseline
  try {
    baseline = source.prepare('SELECT title,artist FROM local_tracks').all()
    await backup(source, path.join(directory, 'music.sqlite'))
  } finally {
    source.close()
  }
  await fs.copyFile(path.join(original, 'Local State'), path.join(profile, 'Local State'))
  await fs
    .copyFile(
      path.join(original, 'fitbay-music/music-taste.json'),
      path.join(directory, 'music-taste.json'),
    )
    .catch((e) => {
      if (e.code !== 'ENOENT') throw e
    })
  db = new DatabaseSync(path.join(directory, 'music.sqlite'))
  isolateRecommendationProfile(db, directory)
  const set = db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)')
  set.run('music-media-keys', 'off')
  set.run('music-muted', 'on')
  const old = new Set(
    db
      .prepare('SELECT id FROM batches')
      .all()
      .map((r) => r.id),
  )
  const launch = () =>
    electron.launch({
      args: [
        path.resolve('dist/component-prototype/host'),
        '--mode=music',
        '--mute-audio',
        '--user-data-dir=' + profile,
        '--workbench=' + path.resolve('out/renderer/index.html'),
      ],
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
    })
  app = await launch()
  assert.ok(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')))
  const page = await app.firstWindow()
  const state = await page.evaluate(() => window.music.state())
  assert.notEqual(state.models.active, 'offline')
  assert.ok(state.models.providers.find((p) => p.id === state.models.active)?.hasKey)
  const taste = await page.evaluate(() => window.music.getTasteStatus())
  assert.ok(taste.consented)
  await page.getByRole('tab', { name: '智能推荐' }).click()
  const preference =
    process.argv[2] ||
    '结合我的审美，发现一些库里没有的旋律性作品。今天想听独立音乐人正式公开免费下载的日系、游戏或轻电子器乐，优先免费的原创录音。'
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill(preference)
  const native = process.env.FITBAY_NATIVE_FOLDER === '1'
  await app.evaluate(
    ({ dialog }, { output, native }) => {
      let count = 0
      globalThis.liveModelRequests = 0
      const fetch = globalThis.fetch
      globalThis.fetch = (...args) => {
        globalThis.liveModelRequests++
        return fetch(...args)
      }
      const show = dialog.showOpenDialog.bind(dialog)
      dialog.showOpenDialog = async (options) => {
        if (options.title !== '选择推荐下载目录') throw Error('意外的原生对话框')
        count++
        if (native) {
          const result = await show({ ...options, defaultPath: output })
          if (!result.canceled && (result.filePaths.length !== 1 || result.filePaths[0] !== output))
            throw Error('验收只允许选择本次创建的隔离下载目录')
          return result
        }
        return Promise.resolve(
          count === 1
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [output] },
        )
      }
    },
    { output, native },
  )
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成推荐', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await expect(page.getByLabel('想让 AI 推荐什么？（选填）')).toHaveValue(preference)
  assert.equal(await app.evaluate(() => globalThis.liveModelRequests), 0)
  assert.equal((await page.evaluate(() => window.music.state())).prefs.recommendDir, '')
  const runs = db.prepare('SELECT batch,state,message FROM recommendation_runs').all()
  assert.equal(runs.length, 1)
  const [cancelled] = runs
  assert.ok(!old.has(cancelled.batch))
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(cancelled.message, '未选择推荐下载目录')
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM items WHERE batch=?').get(cancelled.batch).n,
    0,
  )
  assert.deepEqual(await fs.readdir(output), [])
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByRole('button', { name: '终止本次推荐' })).toBeHidden({
    timeout: 1200000,
  })
  const alert = await page.getByRole('alert').allTextContents()
  if (alert.length) console.log('界面提示', alert)
  const batch = db
    .prepare('SELECT id FROM batches ORDER BY rowid DESC')
    .all()
    .find((r) => !old.has(r.id) && r.id !== cancelled.batch)
  assert.ok(batch, alert.join('；') || '界面生成未创建新批次')
  const rows = db
    .prepare(
      'SELECT i.title,i.artist,i.status,r.error,r.local,t.file FROM items i JOIN recommended_items r ON r.item=i.id LEFT JOIN local_tracks t ON t.id=r.local WHERE i.batch=?',
    )
    .all(batch.id)
  const saved = rows.filter((r) => r.status === '已入库' && r.file && !inLibrary(r, baseline))
  console.log(
    '原库',
    baseline.length,
    '首，模型',
    state.models.active,
    '，新入库',
    saved.length,
    '首；逐曲结果',
    rows.map(({ title, status, error }) => ({ title, status, error })),
  )
  await page.screenshot({ path: path.join(root, '每日推荐.png') })
  assert.ok(saved.length)
  const first = saved[0]
  assert.equal(path.dirname(first.file), output)
  const file = await fs.stat(first.file)
  assert.ok(file.size > 0)
  const result = await page.evaluate(() => window.music.state())
  assert.ok(
    result.playlists.find((p) => p.system && p.name === '歌曲推荐')?.tracks.includes(first.local),
  )
  const item = page
    .locator('.music-list ol li')
    .filter({ has: page.getByText(first.title, { exact: true }) })
    .first()
  await item
    .getByRole('button', { name: /试听|播放/ })
    .first()
    .click()
  await expect.poll(() => page.locator('audio').evaluate((a) => a.currentTime)).toBeGreaterThan(1)
  const playback = await page.locator('audio').evaluate((a) => ({
    protocol: new URL(a.currentSrc).protocol,
    time: a.currentTime,
    duration: a.duration,
    paused: a.paused,
  }))
  assert.equal(playback.paused, false)
  assert.equal(playback.protocol, 'fitbay-audio:')
  assert.equal(result.prefs.recommendDir, output)
  async function visibleBatch() {
    const latest = db.prepare('SELECT id FROM batches ORDER BY rowid DESC LIMIT 1').get().id
    const candidates = db.prepare('SELECT title,artist FROM items WHERE batch=?').all(latest)
    const titles = await page.locator('.music-list ol li strong').allTextContents()
    assert.ok(titles.length <= 5)
    const visible = titles.map((title) => {
      const song = candidates.find((candidate) => candidate.title === title)
      assert.ok(song, '页面混入旧批次')
      assert.ok(!inLibrary(song, baseline), '页面混入已有曲目')
      return song
    })
    return {
      id: latest,
      visible,
      summary: await page.locator('.music-tools small, .music-empty p').first().textContent(),
    }
  }
  const firstBatch = await visibleBatch()
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成推荐', exact: true })).toBeEnabled({
    timeout: 1200000,
  })
  const secondBatch = await visibleBatch()
  assert.notEqual(firstBatch.id, secondBatch.id)
  const overlap = secondBatch.visible.filter((song) => inLibrary(song, firstBatch.visible))
  assert.deepEqual(overlap, [])
  await page.screenshot({ path: path.join(root, '第二次推荐.png') })
  console.log('两次真实生成', JSON.stringify({ firstBatch, secondBatch, overlap }))
  await app.close()
  app = await launch()
  const restarted = await app.firstWindow()
  assert.equal((await restarted.evaluate(() => window.music.state())).prefs.recommendDir, output)
  const evidence = {
    folderChoice: { native, cancelled, cancellationModelRequests: 0, restoredAfterRestart: true },
    model: state.models.active,
    taste: taste.status,
    baseline: baseline.length,
    preference,
    firstBatch,
    secondBatch,
    overlap,
    saved: saved.length,
    rows: rows.map(({ title, artist, status, error }) => ({
      title,
      artist,
      status,
      error,
    })),
    played: first.title,
    file: first.file,
    bytes: file.size,
    playback,
  }
  await fs.writeFile(path.join(root, '验收.json'), JSON.stringify(evidence, null, 2))
  console.log('PASS', JSON.stringify(evidence))
} finally {
  await app?.close()
  db?.close()
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  })
}
