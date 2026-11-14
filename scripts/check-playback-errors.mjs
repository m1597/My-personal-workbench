import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/playback-errors-'))
for (const language of ['zh-CN', 'en']) {
  const profile = path.join(root, language)
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  await writeFile(path.join(profile, 'interface-language'), language)
  store.set('music-guide-v1', '1')
  store.set('lx-bootstrap', 'done')
  for (const [title, bytes] of [
    ['Bad', Buffer.from('invalid MPEG frames')],
    ['Good', recording('fitbay-tone-1')],
  ]) {
    const file = path.join(profile, title + (title === 'Bad' ? '.mp3' : '.wav'))
    await writeFile(file, bytes)
    store.library.upsert({ title, artist: 'Fixture', album: '', file, duration: 20 })
  }
  store.db.close()
  const app = await electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST_DIR || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '播放Bad', exact: true }).click()
    const status = page.locator('.music-player p[role=status]')
    await expect(status).toContainText(
      language === 'en' ? 'Bad · This file could not be decoded' : 'Bad · 无法解码此文件',
    )
    await page.screenshot({
      path: path.join(root, language + '-bad.png'),
      style: ':root{background:var(--base)!important}',
    })
    await page.getByRole('button', { name: '播放Good', exact: true }).click()
    await expect
      .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.2))
      .toBe(true)
    await expect(status).toBeEmpty()
    await page.screenshot({
      path: path.join(root, language + '-recovered.png'),
      style: ':root{background:var(--base)!important}',
    })
    assert.ok(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')))
    await page.getByRole('button', { name: '打开歌词页' }).click()
    const backLabel = language === 'en' ? 'Back' : '返回'
    const back = page.getByRole('region', { name: '播放页' }).getByRole('button', {
      name: backLabel,
      exact: true,
    })
    await expect(back).toHaveAttribute('title', backLabel)
    assert.equal(await back.textContent(), '')
    await back.click()
    // Reject the older play promise after a later successful resume of this recording.
    await page.evaluate(() => {
      const el = document.querySelector('audio')
      const original = el.play.bind(el)
      el.play = () => {
        el.play = original
        return new Promise((_, reject) => {
          globalThis.failOld = () =>
            reject(new DOMException('no supported source', 'NotSupportedError'))
        })
      }
    })
    const pause = page.getByRole('button', { name: '暂停', exact: true })
    await pause.click()
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect.poll(() => page.evaluate(() => typeof globalThis.failOld)).toBe('function')
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect.poll(() => page.locator('audio').evaluate((a) => !a.paused)).toBe(true)
    await page.evaluate(() => globalThis.failOld())
    await expect(status).toBeEmpty()
  } finally {
    await app.close()
  }
}
console.log('PASS 中英文实际坏文件、切歌恢复及旧请求迟到', root)
