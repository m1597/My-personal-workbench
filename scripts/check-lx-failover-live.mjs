import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { sourceCatalog } from '../examples/component-host/lx-source-catalog.mjs'

// Opt-in live acceptance. Copy only the two named source definitions into fresh profiles.
const [database, primaryName, backupName, executablePath] = process.argv.slice(2)
assert.ok(
  database && primaryName && backupName && primaryName !== backupName,
  '用法：node scripts/check-lx-failover-live.mjs 曲库数据库 当前源名 备用源名 [Music.exe]',
)
const original = new DatabaseSync(database, { readOnly: true })
const imported = original
  .prepare('SELECT payload FROM music_sources ORDER BY rowid')
  .all()
  .map((row) => JSON.parse(row.payload))
original.close()
const title = 'Monkeys Spinning Monkeys'
const artist = 'Kevin MacLeod'
for (const [platform, label] of [
  ['tx', 'QQ 音乐'],
  ['kg', '酷狗音乐'],
]) {
  const root = await mkdtemp(path.resolve('tmp', platform + '-failover-'))
  const profile = path.join(root, 'profile')
  const downloads = path.join(root, 'downloads')
  await mkdir(downloads)
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  const bank = sourceCatalog(store.db)
  for (const name of [primaryName, backupName]) {
    const matches = imported.filter((src) => src.name === name)
    assert.equal(matches.length, 1, '需提供唯一的已导入源名称：' + name)
    bank.install(matches[0], null, name === primaryName)
  }
  store.set('music-manual-dir', downloads)
  store.db.close()
  const args = ['--mute-audio', '--user-data-dir=' + profile]
  if (!executablePath) args.unshift(path.resolve('dist/component-prototype/host'), '--mode=music')
  const app = await electron.launch({
    executablePath,
    args,
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  try {
    const page = await app.firstWindow()
    assert.ok(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')))
    await page.getByRole('button', { name: '跳过', exact: true }).click()
    await page.getByRole('tab', { name: '下载音乐', exact: true }).click()
    const pane = page.getByRole('region', { name: '下载音乐' })
    await pane.getByRole('tab', { name: label }).click()
    await pane.getByRole('textbox', { name: '歌名', exact: true }).fill(title)
    await pane.getByRole('textbox', { name: '艺人', exact: true }).fill(artist)
    const find = pane.getByRole('button', { name: '查找版本' })
    await find.click()
    const selected = pane
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: true }) })
      .filter({ hasText: artist })
      .first()
    await expect(selected).toBeVisible({ timeout: 60000 })
    await pane.getByRole('combobox', { name: '下载音质' }).click()
    await page.getByRole('option', { name: '128k', exact: true }).click()
    await selected.getByRole('button', { name: '下载', exact: true }).click()
    await expect(find).toBeEnabled({ timeout: 240000 })
    const status = await pane.getByRole('status').textContent()
    console.log(label, status)
    assert.ok(status.includes(primaryName + ' → ' + backupName) && status.includes('已下载并入库'))
    assert.equal(await page.evaluate(() => window.music.lxInfo()), primaryName)
    const tracks = await page.evaluate(async () => (await window.music.state()).localTracks)
    assert.equal(tracks.length, 1)
    assert.ok(!(await readdir(downloads)).some((f) => f.endsWith('.part')))
    await page.getByRole('tab', { name: '本地曲库', exact: true }).click()
    await page.getByRole('button', { name: '播放' + tracks[0].title, exact: true }).click()
    const audio = page.locator('audio')
    await expect
      .poll(() =>
        audio.evaluate(
          (a) =>
            !a.paused &&
            a.currentTime > 0.5 &&
            a.duration > 120 &&
            a.duration < 130 &&
            a.currentSrc.startsWith('fitbay-audio:'),
        ),
      )
      .toBe(true)
    const evidence = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), {
      readOnly: true,
    })
    const copy = evidence
      .prepare('SELECT source,sourceId,platform,quality FROM recording_copies')
      .get()
    evidence.close()
    assert.equal(copy.platform, platform)
    assert.equal(
      copy.sourceId,
      platform === 'tx' ? '000l6b9v0OZO45' : 'F09B7FAE3D1A3860C10738EBB33DCBBA',
    )
    assert.equal(copy.source, backupName)
    assert.equal(copy.quality, '128k')
    console.log(
      'PASS',
      root,
      copy,
      await audio.evaluate((a) => ({ time: a.currentTime, duration: a.duration })),
    )
  } finally {
    await app.close()
  }
}
