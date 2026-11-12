import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { dragMusicIn } from './music-drag-fixture.mjs'

const evidence = await mkdtemp(path.resolve('tmp/music-collections-'))
const root = path.join(evidence, '我的音乐')
const wave = recording('fitbay-tone-1')
const titles = ['晨间', '海边', '雨夜']
const directories = ['录音/春天', '录音/夏天', '现场']
for (const [i, title] of titles.entries()) {
  const dir = path.join(root, directories[i])
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, title + '.wav'), wave)
}
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + path.join(evidence, 'profile'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  assert.ok(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')))
  let page = await app.firstWindow()
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  const resize = (width) =>
    app.evaluate(
      ({ BaseWindow }, width) =>
        BaseWindow.getAllWindows()
          .find((w) => w.getTitle() === 'Music')
          .setContentSize(width, 600),
      width,
    )
  await resize(1040)
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  await page.getByRole('tab', { name: '设置' }).click()
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await expect(page.locator('.library-row')).toHaveCount(3)
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('展开我的音乐').click()
  await button('展开录音').click()
  await button('春天').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间'])
  for (const name of ['通勤', '收藏']) {
    await button('新建歌单').click()
    await page.getByLabel('歌单名称').fill(name)
    await button('创建').click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await button('全部歌曲').click()
  await button('多选').click()
  await expect(button('加入歌单')).toBeDisabled()
  await expect(button('从当前歌单移除')).toHaveCount(0)
  await page.getByRole('checkbox', { name: '选择晨间' }).check()
  await expect(page.getByRole('checkbox', { name: '全选当前列表' })).toBeChecked({
    indeterminate: true,
  })
  await page.getByRole('searchbox', { name: '搜索本地歌曲' }).fill('海边')
  await expect(button('加入歌单')).toBeDisabled()
  await page.getByRole('checkbox', { name: '全选当前列表' }).check()
  await button('加入歌单').click()
  await page.getByRole('menuitem', { name: '通勤' }).click()
  await button('通勤').click()
  await expect(page.locator('.library-name strong')).toHaveText(['海边'])
  await button('全部歌曲').click()
  await button('多选').click()
  await page.getByRole('checkbox', { name: '全选当前列表' }).check()
  await expect(page.getByText('已选 3 首')).toBeVisible()
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await button('加入歌单').click()
  await page.screenshot({ path: path.join(evidence, 'batch-playlist.png'), animations: 'disabled' })
  await page.getByRole('menuitem', { name: '通勤' }).click()
  await button('通勤').click()
  await expect(page.locator('.library-row')).toHaveCount(3)
  await button('多选').click()
  await page.getByRole('checkbox', { name: '全选当前列表' }).check()
  await button('从当前歌单移除').click()
  await expect(page.locator('.library-row')).toHaveCount(0)
  await button('全部歌曲').click()
  await expect(page.locator('.library-row')).toHaveCount(3)
  const atomic = await page.evaluate(async () => {
    const state = await window.music.state()
    const list = state.playlists.find((p) => p.name === '通勤').id
    const id = state.localTracks[0].id
    try {
      await window.music.setMembership(list, [id, 'missing-track'], true)
      return false
    } catch {
      return (
        typeof id === 'string' &&
        !(await window.music.state()).playlists.find((p) => p.id === list).tracks.length
      )
    }
  })
  assert.ok(atomic, '失效的歌曲应中止整批写入')
  for (const [song, lists] of [
    ['晨间', ['通勤', '收藏']],
    ['雨夜', ['通勤']],
  ]) {
    await button('管理歌单' + song).click()
    for (const list of lists) await page.getByLabel(list, { exact: true }).check()
    await page.keyboard.press('Escape')
  }
  await button('通勤').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间', '雨夜'])
  await button('播放晨间').click()
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate((el) => el.currentTime)).toBeGreaterThan(0.2)
  await button('暂停晨间').click()
  const pausedAt = await audio.evaluate((el) => el.currentTime)
  await expect.poll(() => audio.evaluate((el) => el.paused)).toBe(true)
  await button('播放晨间').click()
  await expect.poll(() => audio.evaluate((el) => el.currentTime)).toBeGreaterThan(pausedAt)
  for (const label of ['全部歌曲', '春天', '通勤']) {
    await expect(button(label)).toHaveCSS('font-size', '16px')
  }
  await expect(page.getByRole('heading', { name: '我的歌单' })).toHaveCSS('font-size', '16px')
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).queue.length))
    .toBe(2)
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  const spacing = await page
    .locator('.library-title')
    .evaluate(
      (title) =>
        title.querySelector('small').getBoundingClientRect().top -
        title.querySelector('h2').getBoundingClientRect().bottom,
    )
  assert.ok(spacing >= 3.9, String(spacing))
  await page.screenshot({ path: path.join(evidence, 'standalone.png') })
  await resize(400)
  await expect(button('曲库导航')).toBeVisible()
  await expect(page.locator('.library-sidebar')).not.toBeVisible()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(evidence, 'narrow.png') })
  await dragMusicIn(app)
  const shell = app.windows().find((p) => p.url().includes('/renderer/index.html'))
  await expect(page.locator('[data-surface="embedded"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '通勤' })).toBeVisible()
  const tab = shell.locator('[data-tab-panel-id="component-music"] .dv-default-tab-content')
  await expect(tab).toHaveCount(1)
  assert.equal(await tab.evaluate((el) => getComputedStyle(el, '::before').width), '16px')
  const geometry = await tab.evaluate((title) => {
    const tab = title.closest('.dv-tab')
    const rect = tab.getBoundingClientRect()
    const header = tab.closest('.dv-tabs-and-actions-container').getBoundingClientRect()
    const close = tab.querySelector('.dv-default-tab-action').getBoundingClientRect()
    const label = title.getBoundingClientRect()
    return {
      height: header.height,
      topInset: rect.top - header.top,
      baseline: header.bottom - rect.bottom,
      centerDelta: (label.top + label.bottom - close.top - close.bottom) / 2,
      titleOffset: (label.top + label.bottom - rect.top - rect.bottom) / 2,
    }
  })
  assert.ok(Math.abs(geometry.height - 38) <= 1, JSON.stringify(geometry))
  assert.ok(Math.abs(geometry.topInset - 4) <= 0.5, JSON.stringify(geometry))
  assert.ok(Math.abs(geometry.titleOffset) <= 1, JSON.stringify(geometry))
  assert.ok(
    Math.abs(geometry.baseline) <= 1 && Math.abs(geometry.centerDelta) <= 1,
    JSON.stringify(geometry),
  )
  await shell.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  async function captureDock(prefix) {
    await page.screenshot({
      path: path.join(evidence, prefix + '-content.png'),
      omitBackground: true,
    })
    await shell.screenshot({ path: path.join(evidence, prefix + '-shell.png') })
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getBounds(),
    )
    await writeFile(path.join(evidence, prefix + '-bounds.json'), JSON.stringify(bounds))
  }
  await captureDock('docked')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setMinimumSize(380, 480)
    w.setContentSize(440, 620)
  })
  await expect(button('曲库导航')).toBeVisible()
  await expect(page.locator('.music-player')).toBeInViewport()
  await captureDock('narrow-dock')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await button('曲库导航').click()
  await button('收藏').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间'])
  await resize(1040)
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await button('通勤').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名歌单' }).click()
  await page.getByRole('textbox', { name: '新歌单名称' }).fill('收藏')
  await button('保存名称').click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('已有同名歌单')
  await page.getByRole('textbox', { name: '新歌单名称' }).fill('通勤精选')
  await button('保存名称').click()
  await expect(button('通勤精选')).toBeVisible()
  await button('通勤精选').click()
  await button('从曲库移除晨间').click()
  const trashButton = button('移至系统回收站')
  await expect(trashButton).toHaveText('移至系统回收站')
  await resize(400)
  await expect(trashButton).toBeInViewport()
  assert.ok(await trashButton.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
  await page.screenshot({
    path: path.join(evidence, 'remove-in-playlist-narrow.png'),
    animations: 'disabled',
  })
  await resize(1040)
  await button('仅从当前歌单移除').click()
  await expect(page.locator('.library-name strong')).toHaveText(['雨夜'])
  await button('收藏').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间'])
  await button('展开我的音乐').click()
  await button('录音').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '从曲库移除文件夹' })).toBeVisible()
  await page.screenshot({ path: path.join(evidence, 'folder-menu.png'), animations: 'disabled' })
  await page.getByRole('menuitem', { name: '从曲库移除文件夹' }).click()
  await button('确认移除文件夹').click()
  await expect(button('录音')).toHaveCount(0)
  await page.locator('.library-name strong').dblclick()
  await expect(button('暂停晨间')).toBeVisible()
  await button('全部歌曲').click()
  await expect(page.locator('.library-name strong')).toHaveText(['雨夜'])
  await page.locator('.library-name strong').click()
  await expect(button('播放雨夜')).toBeVisible()
  await page.locator('.library-name strong').dblclick()
  await expect(button('暂停雨夜')).toBeVisible()
  await button('管理歌单雨夜').click()
  await expect(button('暂停雨夜')).toBeVisible()
  await page.keyboard.press('Escape')
  await button('从曲库移除雨夜').click()
  await page.screenshot({ path: path.join(evidence, 'remove-track.png'), animations: 'disabled' })
  await button('仅从 FitBay 移除').click()
  await expect(page.locator('.library-row')).toHaveCount(0)
  await button('通勤精选').click()
  await expect(page.locator('.library-row')).toHaveCount(0)
  await button('通勤精选').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除歌单' }).click()
  await button('确认删除歌单').click()
  await expect(button('通勤精选')).toHaveCount(0)
  for (const [i, title] of titles.entries())
    assert.equal((await stat(path.join(root, directories[i], title + '.wav'))).size, wave.length)

  const file = path.join(root, directories[1], titles[1] + '.wav')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.evaluate(() => window.music.importLocal('files'))
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).importJob.running))
    .toBe(false)
  await page.getByRole('tab', { name: '下载音乐' }).click()
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await button('全部歌曲').click()
  await expect(page.locator('.library-name strong')).toHaveText(['海边'])
  const trash = async () => {
    await button('从曲库移除海边').click()
    await button('移至系统回收站').click()
  }
  await app.evaluate(({ dialog }, expected) => {
    dialog.showMessageBox = async (opts) => {
      if (opts.detail !== expected || opts.defaultId !== 0 || opts.cancelId !== 0)
        throw Error('路径或取消选项错误')
      return { response: 0 }
    }
  }, file)
  await trash()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal((await stat(file)).size, wave.length)
  await app.evaluate(({ dialog, shell }, expected) => {
    dialog.showMessageBox = async (opts) => {
      if (opts.detail !== expected || opts.buttons[1] !== '移至回收站')
        throw Error('回收站确认路径错误')
      return { response: 1 }
    }
    const original = shell.trashItem
    shell.trashItem = async (target) => {
      shell.trashItem = original
      if (target !== expected) throw Error('错误路径')
      throw Error('模拟系统回收站失败')
    }
  }, file)
  await trash()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('曲库记录已保留')
  assert.equal((await stat(file)).size, wave.length)
  await button('移至系统回收站').click()
  await expect(page.locator('.library-row')).toHaveCount(0)
  await assert.rejects(stat(file), { code: 'ENOENT' })
  await button('收藏').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间'])
  console.log(
    'PASS 单选、全选当前结果、批量加入和移除歌单、失效批次回滚、文件夹移除保留歌单播放、重命名、删除歌单、单歌移除范围、双击播放、回收站取消/失败/成功。截图 ' +
      evidence,
  )
} finally {
  await app.close()
}
