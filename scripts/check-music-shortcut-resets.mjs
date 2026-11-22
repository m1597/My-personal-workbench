import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/music-shortcut-reset-'))
for (const mode of ['music', 'workbench']) {
  const profile = path.join(evidence, mode)
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  store.set('music-guide-v1', '1')
  store.set('lx-bootstrap', 'done')
  store.db.close()
  for (const restart of [false, true]) {
    const app = await electron.launch({
      args: [
        path.resolve('dist/component-prototype/host'),
        '--mode=' + mode,
        '--workbench=' + path.resolve('out/renderer/index.html'),
        '--mute-audio',
        '--user-data-dir=' + profile,
      ],
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
    })
    try {
      let page = await app.firstWindow()
      if (mode === 'workbench') {
        await page.getByRole('button', { name: '组件', exact: true }).click()
        const item = page.getByRole('menuitemcheckbox', { name: 'Music', exact: true })
        if (await item.isChecked()) await page.keyboard.press('Escape')
        else await item.click()
        await expect
          .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
          .toBe(true)
        page = app.windows().find((p) => p.url().includes('/music/index.html'))
      }
      await openMusicSettings(page)
      await selectMusicSettings(page, '快捷键')
      const local = page.getByLabel('启用应用内快捷键')
      const global = page.getByLabel('启用全局快捷键')
      const media = page.getByLabel('启用键盘媒体键')
      const field = (name) => page.getByRole('textbox', { name, exact: true })
      const toggle = '应用内播放 / 暂停',
        next = '下一首'
      if (!restart) {
        await local.uncheck()
        await global.check()
        await media.uncheck()
        const reserved = await app.evaluate(({ globalShortcut }) =>
          globalShortcut.register('Ctrl+Shift+F11', () => {}),
        )
        expect(reserved).toBe(true)
        const save = async (name, key) => {
          await field(name).click()
          await field(name).press(key)
          await page.getByRole('button', { name: '保存' + name + '快捷键', exact: true }).click()
        }
        await save(toggle, 'F8')
        await save(next, 'Control+Shift+F9')
        await save(next, 'Control+Shift+F11')
        await expect(page.getByRole('status')).toContainText('已被占用')
        expect(
          await page.evaluate(async () => (await window.music.state()).prefs.shortcuts.next),
        ).toBe('Ctrl+Shift+F9')
        await save('应用内下一首', 'F8')
        await expect(page.getByRole('status')).toContainText('已分配')
        await field(toggle).click()
        await field(toggle).press('Escape')
        await expect(field(toggle)).toHaveValue('F8')
        await field(toggle)
          .locator('xpath=ancestor::form')
          .getByRole('button', { name: '恢复默认' })
          .click()
        await expect(field(toggle)).toHaveValue('Space')
        expect(
          await page.evaluate(async () => (await window.music.state()).prefs.shortcuts.next),
        ).toBe('Ctrl+Shift+F9')
        await save(toggle, 'F10')
        await page.getByRole('button', { name: '恢复全部 Music 默认快捷键' }).click()
      }
      await expect(field(toggle)).toHaveValue('Space')
      await expect(field(next)).toHaveValue('Ctrl+Alt+Right')
      await expect(local).not.toBeChecked()
      await expect(global).toBeChecked()
      await expect(media).not.toBeChecked()
      await page.screenshot({ path: path.join(evidence, mode + '-' + restart + '.png') })
    } finally {
      await app.close()
    }
  }
  console.log('PASS', mode, evidence)
}
