import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/timed-playlist-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const name = '下班路上'
const playlist = store.library.createPlaylist(name)
for (const minutes of [14, 13, 12]) {
  const duration = minutes * 60 + (minutes === 13 ? -0.5 : minutes === 12 ? 0.5 : 0)
  const title = minutes + '分钟录音'
  const file = path.join(root, title + '.wav')
  const bytes = duration * 8000
  const wav = Buffer.alloc(bytes + 44, 128)
  wav.write('RIFF')
  wav.writeUInt32LE(bytes + 36, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(8000, 28)
  wav.writeUInt16LE(1, 32)
  wav.writeUInt16LE(8, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(bytes, 40)
  await writeFile(file, wav)
  store.library.upsert({ title, file, artist: '测试艺人', album: '', duration })
  store.library.setMembership(
    playlist,
    store.library.list().find((r) => r.title === title).id,
    true,
  )
}
store.db.close()
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
  const page = await app.firstWindow()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(960, 720),
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('跳过').click()
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  await button(name).click()
  await button('歌单播放选项').click()
  const dialog = page.locator('.timed-playlist')
  const input = dialog.getByRole('textbox')
  const preview = dialog.getByRole('status')
  await expect(input).toHaveValue('25')
  await expect(preview).toHaveText('2 首 · 实际总时长 25:00')
  await page.screenshot({ path: path.join(root, '25分钟.png'), animations: 'disabled' })
  await input.fill('60')
  await expect(preview).toHaveText('3 首 · 实际总时长 39:00')
  await expect(dialog.getByText(/已选全部可用本地歌曲/)).toBeVisible()
  await input.fill('5')
  await expect(button('开始播放')).toBeDisabled()
  await expect(preview).toContainText('没有能在这段时间内播完')
  await input.fill('0')
  await expect(preview).toHaveText('请输入有效时长')
  await input.fill('25')
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  await button('开始播放').click()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const s = await window.music.state()
        return s.queue.map((id) => s.localTracks.find((row) => row.id === id)?.title)
      }),
    )
    .toEqual(['13分钟录音', '12分钟录音'])
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
  await audio.evaluate((a) => {
    a.currentTime = a.duration - 0.2
  })
  await expect(page.locator('.music-transport strong')).toHaveText('12分钟录音')
  await expect.poll(() => audio.evaluate((a) => !a.paused && a.duration === 720.5)).toBe(true)
  await audio.evaluate((a) => {
    a.currentTime = a.duration - 0.2
  })
  await expect.poll(() => audio.evaluate((a) => a.ended)).toBe(true)
  console.log('PASS 25分钟完整选曲、输入校验、时长不足、原序衔接及末曲停止', root)
} finally {
  await app.close()
}
