import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
import { toolkitConnections } from '../components/toolkit/toolkit-connections.mjs'
import { openConnections } from '../examples/component-host/api-connections.mjs'

const profile = await mkdtemp(path.resolve('tmp/toolkit-connections-'))
const settings = path.join(profile, 'toolkit/settings.json')
const standalone = process.argv.includes('--packaged')
  ? {
      executablePath: path.resolve('.cache/fitbay-build/toolkit/win-unpacked/FitBay Toolkit.exe'),
      args: [],
    }
  : { args: [path.resolve('components/toolkit')] }
standalone.args.push('--workbench-profile=' + profile)
const marker = randomUUID()
const endpoint = 'http://127.0.0.1:18080/' + 'long-service-name/'.repeat(5) + 'v1'
const keys = {
  capture: { enabled: false, key: 'Ctrl+Alt+F8' },
  selection: { enabled: false, key: 'Ctrl+Alt+F9' },
}
let app, host
try {
  app = await _electron.launch(standalone)
  let home = await app.firstWindow()
  await expect(home.getByText('立即截图')).toBeVisible()
  async function region() {
    const ready = app.waitForEvent('window')
    await home.getByText('立即截图').click()
    const overlay = await ready
    await expect(overlay.locator('.screen img')).toBeVisible()
    await overlay.mouse.move(20, 20)
    await overlay.mouse.down()
    await overlay.mouse.move(90, 70)
    await overlay.mouse.up()
    return overlay
  }
  let overlay = await region()
  const pinReady = app.waitForEvent('window')
  await overlay.getByText('贴图置顶').click()
  const pin = await pinReady
  await expect(pin.locator('.pinned img')).toBeVisible()
  await pin.close()
  overlay = await region()
  await app.evaluate(({ clipboard }) => {
    globalThis.originalCopy = clipboard.writeImage
    clipboard.writeImage = (image) => {
      globalThis.hasCopy = !image.isEmpty()
    }
  })
  await overlay
    .getByText('复制', { exact: true })
    .click()
    .catch((error) => {
      if (!overlay.isClosed()) throw error
    })
  assert(
    await app.evaluate(({ clipboard }) => {
      clipboard.writeImage = globalThis.originalCopy
      return globalThis.hasCopy
    }),
  )
  overlay = await region()
  const resultReady = app.waitForEvent('window')
  await overlay.getByText('截图翻译').click()
  const result = await resultReady
  await result.getByText('打开 API 设置').click()
  await expect(home.getByLabel('用途')).toHaveValue('translation')
  await expect(home.getByLabel('服务地址')).toBeFocused()
  const encrypted = await app.evaluate(
    ({ safeStorage }, key) => safeStorage.encryptString(key).toString('base64'),
    marker,
  )
  await app.close()
  app = undefined
  await writeFile(
    settings,
    JSON.stringify({ ...keys, endpoint, model: 'legacy-text', secret: encrypted }),
  )
  host = await _electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=workbench',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const shell = await host.firstWindow()
  await shell.getByRole('button', { name: '工作台设置' }).click()
  await shell.getByRole('button', { name: 'API 与模型', exact: true }).click()
  await shell.getByRole('button', { name: '翻译', exact: true }).click()
  const form = shell.locator('.api-connections form')
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('legacy-text')
  app = await _electron.launch(standalone)
  home = await app.firstWindow()
  await expect(home.getByLabel('模型名')).toHaveValue('legacy-text')
  const legacy = JSON.parse(await readFile(settings, 'utf8'))
  assert.deepEqual(legacy.capture, keys.capture)
  assert.deepEqual(legacy.selection, keys.selection)
  assert(!Object.hasOwn(legacy, 'secret'))
  const db = openConnections(profile)
  try {
    for (const use of ['toolkit.translation', 'toolkit.vision'])
      assert(db.resolve(use).key === marker)
  } finally {
    db.close()
  }
  await form.getByLabel('模型', { exact: true }).fill('from-global')
  await form.getByText('保存配置').click()
  await expect(home.getByLabel('模型名')).toHaveValue('from-global')
  await home.getByLabel('模型名').fill('from-toolkit')
  await home.getByText('保存 API 配置').click()
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('from-toolkit')
  await home.getByLabel('用途').selectOption('vision')
  await home
    .getByLabel('连接', { exact: true })
    .selectOption({ label: '复用 · 截图与划词 · 翻译 — from-toolkit' })
  await home.getByText('保存 API 配置').click()
  await expect(home.getByRole('status')).toContainText('已保存')
  await expect
    .poll(() =>
      home.evaluate(async () => {
        const { routes } = await window.toolkit.connections()
        return routes.vision.id === routes.translation.id
      }),
    )
    .toBe(true)
  await home.getByLabel('连接', { exact: true }).selectOption('private')
  await home.getByLabel('模型名').fill('vision-only')
  await home.getByText('保存 API 配置').click()
  await expect
    .poll(() =>
      home.evaluate(async () => {
        const { routes } = await window.toolkit.connections()
        return routes.vision.id !== routes.translation.id
      }),
    )
    .toBe(true)
  await expect(home.getByLabel('API 密钥')).toHaveAttribute('type', 'password')
  await expect(home.getByLabel('API 密钥')).toHaveValue('')
  for (const width of [680, 320]) {
    await app.evaluate(
      ({ BrowserWindow }, w) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.getTitle() === 'FitBay 工具集')
          .setContentSize(w, 640),
      width,
    )
    await home.locator('.connections').scrollIntoViewIfNeeded()
    assert(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await home
      .locator('.connections')
      .screenshot({ path: path.join(profile, 'settings-' + width + '.png') })
  }
  assert(
    !(await readFile(path.join(profile, 'api-connections.sqlite'))).includes(Buffer.from(marker)),
  )
  console.log(
    'PASS missing service link, encrypted legacy migration, separate Electron windows, bidirectional edits, reuse, separate, masked long-address settings',
    profile,
  )
} finally {
  await host?.close()
  await app?.close()
}

// Damaged legacy data must keep its original copy until each purpose is replaced.
const damaged = await mkdtemp(path.resolve('tmp/toolkit-repair-'))
let migrated = false
const facade = toolkitConnections({
  shared: damaged,
  packaged: false,
  legacy: { endpoint, model: 'old', secret: 'YmFk' },
  safeStorage: {
    decryptString() {
      throw Error('damaged')
    },
  },
  onChange() {},
  onMigrated() {
    migrated = true
  },
})
try {
  assert.equal((await facade.snapshot()).migrationPending.length, 2)
  const input = { route: 'translation', connection: 'private', endpoint, model: 'fixed', key: '' }
  await facade.save(input)
  assert(!migrated)
  const old = (await facade.snapshot()).routes.translation.id
  await facade.save({ ...input, route: 'vision' })
  assert(migrated)
  const fresh = (await facade.snapshot()).routes.vision.id
  await facade.save({ ...input, connection: fresh })
  await assert.rejects(
    () => facade.save({ ...input, connection: 'edit', expectedId: old, model: 'wrong' }),
    /其他窗口/,
  )
  assert.equal((await facade.resolve('translation')).model, 'fixed')
  console.log('PASS damaged credential replacement and stale concurrent edit rejection')
} finally {
  facade.close()
}
