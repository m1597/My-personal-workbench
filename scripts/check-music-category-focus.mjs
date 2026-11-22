import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

const evidence = await mkdtemp(path.resolve('tmp/music-category-focus-'))
for (const mode of ['music', 'workbench']) {
  const profile = path.join(evidence, mode)
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  store.set('music-guide-v1', '1')
  store.set('lx-bootstrap', 'done')
  store.db.close()
  const app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=' + mode,
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
      '--mute-audio',
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  try {
    let page = await app.firstWindow()
    if (mode === 'workbench') {
      await page.getByRole('button', { name: '组件', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
      await expect
        .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
        .toBe(true)
      page = app.windows().find((p) => p.url().includes('/music/index.html'))
    }
    await openMusicSettings(page)
    await selectMusicSettings(page, '下载')
    const category = page.getByRole('region', { name: '下载', exact: true })
    await expect(page.getByRole('button', { name: '下载', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(category).toHaveCSS('outline-style', 'none')
    await category.getByRole('heading', { name: '下载', exact: true }).click()
    await expect(category).toHaveCSS('outline-style', 'none')
    await page.screenshot({ path: path.join(evidence, mode + '.png') })
    await page.keyboard.press('Tab')
    await expect
      .poll(() =>
        category.evaluate(
          (el) =>
            el !== document.activeElement &&
            el.contains(document.activeElement) &&
            document.activeElement.matches(':focus-visible'),
        ),
      )
      .toBe(true)
    console.log('PASS', mode, evidence)
  } finally {
    await app.close()
  }
}
