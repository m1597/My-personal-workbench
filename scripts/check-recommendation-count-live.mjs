import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { inLibrary } from '../examples/component-host/music-discovery.mjs'

// Explicit live acceptance. Uses the current provider and sources and may incur model charges.
const target = 5
const original = path.resolve('local/desktop-profile')
const root = await fs.mkdtemp(path.resolve('tmp/recommendation-count-live-'))
const profile = path.join(root, 'profile')
const directory = path.join(profile, 'fitbay-music')
const output = path.join(root, '歌曲推荐')
const evidence = { target, root, files: [] }
let app
let db
try {
  console.log('隔离验收目录', root)
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(output)
  const source = new DatabaseSync(path.join(original, 'fitbay-music/music.sqlite'), {
    readOnly: true,
  })
  try {
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
  // A copied legacy save journal can replay publication beside the user's originals at startup.
  db.exec(`DELETE FROM saves;
    DELETE FROM state WHERE key IN ('root','music-manual-dir','music-recommend-dir') OR key LIKE 'shortcut-%';`)
  const set = db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)')
  set.run('music-media-keys', 'off')
  set.run('music-muted', 'on')
  const baseline = db.prepare('SELECT id,title,artist FROM local_tracks').all()
  const oldBatches = new Set(
    db
      .prepare('SELECT id FROM batches')
      .all()
      .map((row) => row.id),
  )
  app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      `--user-data-dir=${profile}`,
      `--workbench=${path.resolve('out/renderer/index.html')}`,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await app.evaluate(({ app, BaseWindow, dialog, screen }, output) => {
    const left = Math.min(...screen.getAllDisplays().map((display) => display.bounds.x))
    const windows = BaseWindow.getAllWindows()
    if (
      !windows.length ||
      !app.commandLine.hasSwitch('mute-audio') ||
      !windows.every((w) => {
        const { x, width } = w.getBounds()
        return x + width <= left && !w.isFocusable()
      })
    )
      throw Error('验收窗口未离屏静音')
    dialog.showOpenDialog = async (options) => {
      if (options.title !== '选择推荐下载目录') throw Error('意外的文件选择器')
      return { canceled: false, filePaths: [output] }
    }
    globalThis.recommendationRounds = []
    const fetch = globalThis.fetch
    globalThis.fetch = (...args) => {
      const body = args[1]?.body
      if (typeof body === 'string' && args[1]?.method === 'POST') {
        try {
          const request = JSON.parse(body)
          const input =
            request.input ??
            request.messages?.at(-1)?.content ??
            request.contents?.[0]?.parts?.[0]?.text
          const payload = JSON.parse(input)
          if (['auto', 'style', 'artist'].includes(payload.mode))
            globalThis.recommendationRounds.push({
              excluded: payload.excluded?.length ?? 0,
              catalogChoices: payload.catalogChoices?.length ?? 0,
              target: payload.count ?? null,
            })
        } catch {
          /* Other POST operations are outside the model round count. */
        }
      }
      return fetch(...args)
    }
  }, output)
  const before = await page.evaluate(() => window.music.state())
  const playlist = (state) =>
    state.playlists.find((p) => p.system && p.name === '歌曲推荐')?.tracks ?? []
  const oldMembers = playlist(before)
  evidence.baseline = {
    library: baseline.length,
    playlist: oldMembers.length,
    files: (await fs.readdir(output)).length,
  }
  evidence.provider = before.models.active
  evidence.source = await page.evaluate(() => window.music.lxInfo())
  assert.notEqual(evidence.provider, 'offline')
  assert.ok(before.models.providers.find((p) => p.id === evidence.provider)?.hasKey)
  assert.ok(evidence.source)
  console.log('验收基线', evidence.baseline, evidence.provider, evidence.source)
  await page.getByRole('tab', { name: '每日推荐' }).click()
  const count = page.getByLabel('推荐首数')
  await expect(count).toHaveValue(String(target))
  await count.fill(String(target))
  const preference = page.getByLabel('描述你想听什么')
  if (process.argv[2]) await preference.fill(process.argv[2])
  const rows = page.locator('.music-list ol li')
  const initialTitles = await rows.locator('strong').allTextContents()
  await page.evaluate(() => {
    const samples = []
    const sample = () => {
      const rows = [...document.querySelectorAll('.music-list ol li')].map((row) => ({
        title: row.querySelector('strong')?.textContent,
        playable: !!row.querySelector(
          'button[aria-label^="试听"], button[aria-label^="播放"], button[aria-label^="暂停"]',
        ),
      }))
      const summary =
        document.querySelector('.music-batch-status [role="status"]')?.textContent || ''
      const next = JSON.stringify({ rows, summary })
      if (samples.at(-1) !== next) samples.push(next)
    }
    sample()
    const observer = new MutationObserver(sample)
    observer.observe(document.querySelector('.music-shell'), {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    window.recommendationSamples = () => {
      sample()
      return samples.map((s) => JSON.parse(s))
    }
  })
  const generate = page.getByRole('button', { name: '生成推荐', exact: true })
  await generate.click()
  await expect(page.getByRole('button', { name: '取消生成' })).toBeVisible()
  await expect(generate).toBeEnabled({ timeout: 30 * 60_000 })
  const state = await page.evaluate(() => window.music.state())
  evidence.rounds = await app.evaluate(() => globalThis.recommendationRounds)
  evidence.samples = await page.evaluate(() => window.recommendationSamples())
  evidence.alerts = await page.getByRole('alert').allTextContents()
  await page.screenshot({
    path: path.join(root, '每日推荐.png'),
    style: ':root { background: var(--base) !important }',
  })
  const batch = state.batches.find((b) => !oldBatches.has(b.id))
  assert.ok(batch, '未生成批次')
  evidence.run = { state: batch.state, target: batch.targetCount, message: batch.message }
  const candidates = db
    .prepare(
      'SELECT i.title,i.artist,i.status,r.local,t.file FROM items i JOIN recommended_items r ON r.item=i.id LEFT JOIN local_tracks t ON t.id=r.local WHERE i.batch=?',
    )
    .all(batch.id)
  const saved = candidates.filter((row) => row.status === '已入库' && row.file)
  const added = state.localTracks
    .filter((row) => !baseline.some((old) => old.id === row.id))
    .map((row) => row.id)
  const finalMembers = playlist(state)
  const expectedIds = saved.map((row) => row.local).sort()
  evidence.candidates = candidates.map(({ title, artist, status }) => ({ title, artist, status }))
  evidence.after = {
    library: state.localTracks.length,
    playlist: finalMembers.length,
    visible: await rows.count(),
    saved: saved.length,
  }
  console.log('验收批次', evidence.after, '模型轮数', evidence.rounds.length)
  assert.ok(evidence.rounds.length > 0, '未观察到真实模型推荐请求')
  assert.equal(batch.state, 'completed', batch.message)
  assert.equal(batch.targetCount, target)
  assert.equal(saved.length, target, JSON.stringify(evidence.alerts))
  assert.equal(state.localTracks.length - baseline.length, target)
  assert.equal(finalMembers.length - oldMembers.length, target)
  assert.deepEqual(added.sort(), expectedIds)
  assert.deepEqual(finalMembers.filter((id) => !oldMembers.includes(id)).sort(), expectedIds)
  assert.deepEqual(
    (await rows.locator('strong').allTextContents()).sort(),
    saved.map((row) => row.title).sort(),
  )
  for (const sample of evidence.samples) {
    const progress = sample.summary.match(/^已下载\s*(\d+)\s*\/\s*5/)
    if (progress) assert.equal(sample.rows.length, Number(progress[1]))
    for (const row of sample.rows) {
      if (initialTitles.includes(row.title)) continue
      assert.ok(
        row.playable && saved.some((r) => r.title === row.title),
        `展示了未成功的候选 ${row.title}`,
      )
    }
  }
  assert.equal(state.prefs.recommendDir, output)
  assert.equal(new Set(saved.map((row) => row.file.toLowerCase())).size, target)
  const localFiles = await fs.readdir(output)
  assert.deepEqual(
    localFiles.filter((f) => !f.endsWith('.lrc')).sort(),
    saved.map((r) => path.basename(r.file)).sort(),
  )
  for (const song of saved) {
    assert.equal(path.dirname(song.file), output)
    assert.ok(!inLibrary(song, baseline))
    const bytes = await fs.readFile(song.file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // Decode the actual saved file with Chromium's codecs, without playing audio or opening a dialog.
    const picker = await page.evaluateHandle(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.hidden = true
      document.body.append(input)
      return input
    })
    await picker.setInputFiles(song.file)
    const decoded = await picker.evaluate(async (input) => {
      const context = new OfflineAudioContext(1, 1, 24000)
      const audio = await context.decodeAudioData(await input.files[0].arrayBuffer())
      input.remove()
      return { seconds: audio.duration, channels: audio.numberOfChannels }
    })
    await picker.dispose()
    assert.ok(decoded.seconds > 1 && decoded.channels > 0)
    evidence.files.push({
      title: song.title,
      artist: song.artist,
      file: path.basename(song.file),
      bytes: bytes.length,
      sha256,
      ...decoded,
    })
  }
  assert.equal(new Set(evidence.files.map((row) => row.sha256)).size, target)
  evidence.passed = true
  console.log(
    'PASS',
    evidence.files.map(({ title, file, seconds }) => ({ title, file, seconds })),
  )
} finally {
  try {
    await fs.writeFile(path.join(root, '验收.json'), JSON.stringify(evidence, null, 2))
    console.log('验收记录', path.join(root, '验收.json'))
  } finally {
    await app?.close()
    db?.close()
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}
