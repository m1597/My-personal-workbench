import { _electron as electron, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import executable from 'electron'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'

await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/music-presentation-'))
const profile = path.join(evidence, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['夜航', '归途']) {
  const file = path.join(evidence, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ file, title, artist: 'FitBay', album: '', duration: 20 })
}
store.db.close()
const args = [
  path.resolve('dist/component-prototype/host'),
  '--workbench=' + path.resolve('out/renderer/index.html'),
  '--user-data-dir=' + profile,
]
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', FITBAY_TEST_PANELS: '1' }
const app = await electron.launch({ args: [...args, '--mode=workbench'], env })
const externalOpen = () =>
  promisify(execFile)(executable, [...args, '--mode=music'], { windowsHide: true, env })

try {
  expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio'))).toBe(true)
  const shell = await app.firstWindow()
  const menu = shell.getByRole('button', { name: '组件', exact: true })
  const musicItem = shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true })
  const reveal = shell.getByRole('menuitem', {
    name: '显示 Music',
    exact: true,
  })
  const hide = shell.getByRole('menuitem', { name: '隐藏 Music', exact: true })
  const tab = shell.getByRole('tab', { name: 'Music', exact: true })
  const bar = shell.locator('[aria-label="Music 播放栏"]')
  async function checked(running, click = false) {
    await menu.click()
    await expect(musicItem).toHaveAttribute('aria-checked', String(running))
    if (!running) await expect(hide).toBeDisabled()
    if (click) await musicItem.click()
    else await shell.keyboard.press('Escape')
  }
  const page = () => app.windows().find((p) => p.url().includes('/music/index.html'))
  async function player() {
    await expect.poll(() => !!page()).toBe(true)
    return page()
  }
  const shellHeight = () =>
    shell.locator('.docking-area').evaluate((e) => e.getBoundingClientRect().height)
  const native = () =>
    app.evaluate(({ BaseWindow, BrowserWindow }) => {
      const window = BaseWindow.getAllWindows().find((w) => w.getTitle() === 'Music')
      return {
        standalone: window?.isVisible() ?? false,
        height: window?.getContentSize()[1],
        docked: BrowserWindow.getAllWindows()[0].contentView.children.some((c) => c.getVisible()),
      }
    })
  for (const docked of [false, true]) {
    if (docked) await checked(false, true)
    else await externalOpen()
    const music = await player()
    await music.getByRole('tab', { name: '曲库' }).click()
    // Offscreen captures omit DWM acrylic. Composite the normal dark fallback for inspection.
    await shell.evaluate(() => delete document.documentElement.dataset.backdrop)
    await music.evaluate(() => delete document.documentElement.dataset.backdrop)
    await app.evaluate(({ BrowserWindow, BaseWindow }) => {
      const shell = BrowserWindow.getAllWindows()[0]
      shell.setBackgroundColor('#202227')
      for (const window of BaseWindow.getAllWindows()) {
        for (const child of window.contentView.children) child.setBackgroundColor('#202227')
      }
    })
    if (docked) {
      const hostWidth = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize()[0],
      )
      for (const width of [1040, 440]) {
        await app.evaluate(({ BrowserWindow }, target) => {
          const win = BrowserWindow.getAllWindows()[0]
          win.setMinimumSize(320, 400)
          win.setContentSize(target, 640)
        }, width)
        const musicTabs = music.getByRole('tablist', { name: '音乐页面' })
        const labels = ['曲库', '歌单', '找歌', '歌手']
        for (const [i, label] of labels.entries())
          await expect(musicTabs.getByRole('tab').nth(i)).toHaveAccessibleName(label)
        await expect.poll(() => music.evaluate(() => innerWidth)).toBeLessThanOrEqual(width + 2)
        console.log(
          '停靠导航宽度',
          width,
          await music.evaluate(() => ({
            viewport: innerWidth,
            tabs: document.querySelector('.music-tabs').clientWidth,
            scroll: document.querySelector('.music-tabs').scrollWidth,
          })),
        )
        for (const control of [
          ...(await musicTabs.getByRole('tab').all()),
          ...(await music.locator('.music-view-actions button:visible').all()),
        ]) {
          await expect(control).toBeInViewport({ ratio: 0.98 })
        }
        await music.getByRole('tab', { name: '歌单', exact: true }).click()
        await expect(music.getByRole('heading', { name: '歌单 / 我的收藏' })).toBeVisible()
        await music.screenshot({
          path: path.join(evidence, '顶栏停靠-' + width + '.png'),
          style: ':root { background: var(--base) !important }',
        })
        const more = music.getByRole('button', { name: '更多音乐操作' })
        await expect(more).toHaveAttribute('title', '更多音乐操作')
        const hideButton = music.locator('.music-view-actions .music-hide-extra')
        if (await hideButton.isVisible()) {
          await expect(hideButton).toHaveAttribute('title', '隐藏到后台')
          expect(await hideButton.evaluate((el) => el === el.parentElement.lastElementChild)).toBe(
            true,
          )
          expect((await hideButton.boundingBox()).x).toBeGreaterThan((await more.boundingBox()).x)
        }
        await more.click()
        if (width === 440) {
          await expect(music.getByRole('menuitem', { name: '使用引导' })).toBeVisible()
          await expect(music.getByRole('menuitem', { name: '隐藏到后台' })).toBeVisible()
        }
        await music.getByRole('menuitem', { name: '音乐设置' }).click()
        await expect(music.locator('.music-settings')).toBeVisible()
        await music.getByRole('tab', { name: '曲库', exact: true }).click()
      }
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 720),
        hostWidth,
      )
    }
    await music.getByRole('button', { name: '播放夜航', exact: true }).click({ timeout: 5000 })
    const clock = () => music.locator('audio').evaluate((a) => a.currentTime)
    const playing = async () => {
      const before = await clock()
      await expect.poll(clock).toBeGreaterThan(before + 0.12)
    }
    await playing()
    const queue = await music.evaluate(async () => {
      window.originalAudio = document.querySelector('audio')
      return (await window.music.state()).queue
    })
    const fullHeight = docked ? await shellHeight() : (await native()).height
    await menu.click()
    await expect(musicItem).toBeChecked()
    await expect(hide).toBeVisible()
    await shell.getByRole('menu').screenshot({
      animations: 'disabled',
      scale: 'css',
      path: path.join(evidence, docked ? '停靠窗口菜单.png' : '独立窗口菜单.png'),
    })
    await hide.click()
    await expect.poll(async () => (await native())[docked ? 'docked' : 'standalone']).toBe(false)
    await playing()
    await menu.click()
    await expect(musicItem).toBeChecked()
    await reveal.click()
    await expect.poll(async () => (await native())[docked ? 'docked' : 'standalone']).toBe(true)
    await music.getByRole('button', { name: '只显示播放栏' }).click()
    await expect(music.locator('.music-navigation')).toBeHidden()
    if (docked) {
      await expect(tab).toHaveCount(0)
      await expect(bar).toBeVisible()
      await expect.poll(async () => (await native()).docked).toBe(true)
      expect(await shellHeight()).toBeLessThan(fullHeight)
      await shell.getByRole('tab', { name: '模块 2', exact: true }).click()
    } else {
      await expect.poll(async () => (await native()).height).toBeLessThan(fullHeight)
    }
    await checked(true)
    await playing()
    const expand = music.getByRole('button', {
      name: '展开 Music',
      exact: true,
    })
    const stop = music.getByRole('button', { name: '停止播放', exact: true })
    const stopBox = await stop.boundingBox()
    expect((await expand.boundingBox()).x).toBeGreaterThanOrEqual(stopBox.x + stopBox.width)
    await menu.click()
    await expect(hide).toBeVisible()
    await expect(reveal).toHaveCount(0)
    await shell.keyboard.press('Escape')
    const volume = music.getByRole('button', { name: '调节音量' })
    await expect(music.getByRole('slider', { name: '音量', exact: true })).toBeHidden()
    await volume.click()
    for (const name of ['播放进度', '音量'])
      await expect(music.getByRole('slider', { name, exact: true })).toBeInViewport()
    const level = music.getByRole('slider', { name: '音量', exact: true })
    await level.focus()
    await level.press('Home')
    await level.press('ArrowRight')
    await expect(level).toHaveValue('1')
    await level.press('Escape')
    await expect(level).toBeHidden()
    const geometry = await music.locator('.music-player').evaluate((footer) => {
      const controls = [...footer.querySelectorAll('button, input[type=range]')].filter(
        (control) => control.getClientRects().length,
      )
      const rect = footer.getBoundingClientRect()
      return {
        height: rect.height,
        viewport: innerHeight,
        width: innerWidth,
        singleRow: controls.every((el) => {
          const box = el.getBoundingClientRect()
          return (
            box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1 && box.right <= innerWidth + 1
          )
        }),
      }
    })
    expect(geometry.height).toBe(40)
    if (docked) expect(geometry.viewport).toBe(40)
    expect(geometry.singleRow).toBe(true)
    console.log('迷你栏实际尺寸', geometry)
    for (const name of [
      '展开 Music',
      '当前顺序播放，切换为随机播放',
      '桌面歌词',
      '播放队列',
      '上一首',
      '暂停',
      '下一首',
      '停止播放',
    ])
      await expect(music.getByRole('button', { name, exact: true })).toBeInViewport()
    await music.getByRole('button', { name: '播放队列' }).click()
    await expect(music.locator('.music-queue')).toBeVisible()
    await expect(music.getByRole('button', { name: '只显示播放栏' })).toBeVisible()
    await music.keyboard.press('Escape')
    await music.getByRole('button', { name: '只显示播放栏' }).click()
    await music.getByRole('button', { name: '暂停', exact: true }).click()
    const progress = music.getByRole('slider', { name: '播放进度' })
    const slider = await progress.boundingBox()
    await progress.click({ position: { x: slider.width * 0.52, y: slider.height / 2 } })
    await expect.poll(clock).toBeGreaterThan(8)
    const paused = await clock()
    await music.evaluate(() => {
      document.documentElement.style.backgroundColor = getComputedStyle(
        document.documentElement,
      ).getPropertyValue('--base')
    })
    await music.screenshot({
      scale: 'css',
      path: path.join(evidence, docked ? '停靠播放栏.png' : '独立播放栏.png'),
    })
    await music.getByRole('button', { name: '打开歌词页' }).click()
    await expect(music.getByRole('region', { name: '播放页' })).toBeVisible()
    await music.getByRole('button', { name: '返回' }).click()
    await music.getByRole('button', { name: '只显示播放栏' }).click()
    await music.getByRole('button', { name: '展开 Music' }).click()
    await expect(music.getByRole('tab', { name: '曲库' })).toBeVisible()
    if (docked) await expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(await clock()).toBe(paused)
    await music.getByRole('button', { name: '隐藏到后台' }).click()
    await expect(tab).toHaveCount(0)
    await expect(bar).toHaveCount(0)
    await expect.poll(async () => (await native())[docked ? 'docked' : 'standalone']).toBe(false)
    await checked(true)
    if (docked) {
      expect(await shellHeight()).toBe(fullHeight)
      await shell.getByRole('tab', { name: '模块 2', exact: true }).click()
      await menu.click()
      await expect(musicItem).toBeChecked()
      await shell.screenshot({
        animations: 'disabled',
        scale: 'css',
        path: path.join(evidence, '后台窗口菜单.png'),
      })
      await shell.keyboard.press('Escape')
    }
    await externalOpen()
    await expect(music.getByRole('button', { name: '只显示播放栏' })).toBeVisible()
    expect(await clock()).toBe(paused)
    expect(
      await music.evaluate(async () => [
        window.originalAudio === document.querySelector('audio'),
        (await window.music.state()).queue,
      ]),
    ).toEqual([true, queue])
    await music.getByRole('button', { name: /^(继续播放|播放)$/ }).click()
    await music.getByRole('button', { name: '隐藏到后台' }).click()
    const hiddenAt = await clock()
    const hiddenTrack = await music.locator('audio').evaluate((audio) => audio.currentSrc)
    await expect.poll(clock, { timeout: 8000 }).toBeGreaterThan(hiddenAt + 2)
    await menu.click()
    await expect(reveal).toHaveAttribute('title', '显示 Music')
    expect(
      await reveal.evaluate((eye) => {
        const main = eye.previousElementSibling.getBoundingClientRect()
        const icon = eye.getBoundingClientRect()
        return icon.top === main.top && icon.left >= main.right
      }),
    ).toBe(true)
    await reveal.click()
    await expect.poll(async () => (await native())[docked ? 'docked' : 'standalone']).toBe(true)
    if (docked) await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(music.getByRole('button', { name: '隐藏到后台' })).toBeVisible()
    expect(await clock()).toBeGreaterThan(hiddenAt + 2)
    expect(await music.locator('audio').evaluate((audio) => audio.currentSrc)).toBe(hiddenTrack)
    expect(
      await music.evaluate(async () => [
        window.originalAudio === document.querySelector('audio'),
        (await window.music.state()).queue,
      ]),
    ).toEqual([true, queue])
    await playing()
    await music.getByRole('button', { name: '隐藏到后台' }).click()
    await playing()
    await checked(true, true)
    await expect.poll(() => !!page()).toBe(false)
    await checked(false)
    console.log(
      'PASS',
      docked ? '停靠' : '独立',
      '播放栏右侧展开、后台持续播放、眼睛恢复同一播放器及队列、二次启动激活、菜单停止',
    )
  }
  await checked(false, true)
  const music = await player()
  await music.getByRole('button', { name: '只显示播放栏' }).click()
  await checked(true, true)
  await expect.poll(() => !!page()).toBe(false)
  await expect(bar).toHaveCount(0)
  console.log('PASS 仅播放栏关闭。截图', evidence)
} finally {
  await app.close()
}

const daily = await electron.launch({
  args: [
    ...args.filter((value) => !value.startsWith('--user-data-dir=')),
    '--user-data-dir=' + path.join(evidence, 'empty-profile'),
    '--mode=workbench',
  ],
  env: { ...env, FITBAY_TEST_PANELS: '0' },
})
try {
  const shell = await daily.firstWindow()
  const original = shell.getByRole('heading', { name: '快速开始', exact: true })
  await expect(original).toBeVisible()
  await expect(shell.getByRole('button', { name: '打开 Music', exact: true })).toBeVisible()
  await shell.getByRole('button', { name: '组件', exact: true }).click()
  await shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
  await expect
    .poll(() => daily.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const music = daily.windows().find((p) => p.url().includes('/music/index.html'))
  await music.getByRole('button', { name: '只显示播放栏' }).click()
  await expect(original).toBeVisible()
  await shell.evaluate(() => delete document.documentElement.dataset.backdrop)
  await daily.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBackgroundColor('#202227'),
  )
  await shell
    .locator('.docking-area')
    .screenshot({ path: path.join(evidence, '仅播放栏中央提示.png') })
  await music.getByRole('button', { name: '展开 Music' }).click()
  await music.getByRole('button', { name: '隐藏到后台' }).click()
  await expect(original).toBeVisible()
  console.log('PASS 普通空工作区和仅剩停靠播放栏的提示')
} finally {
  await daily.close()
}
