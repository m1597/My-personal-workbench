import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'
import electron from 'electron'
const profile = await mkdtemp(path.resolve('tmp/toolkit-shell-'))
await mkdir(path.join(profile, 'toolkit'))
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify(
    Object.fromEntries(
      ['capture', 'selection', 'color'].map((id, i) => [
        id,
        { enabled: false, key: 'Control+Alt+F' + (20 + i) },
      ]),
    ),
  ),
)
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
const args = ['components/toolkit', '--workbench-profile=' + profile]
const host = await _electron.launch({
  args: [
    'dist/component-prototype/host',
    '--mode=workbench',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env,
})
let kit, hostedOnly
async function count(app) {
  // Electron's main process exposes live Tray wrappers to its Node inspector.
  return await app.evaluate(async ({ Tray }) => {
    const { Session } = process.getBuiltinModule('inspector/promises')
    const inspector = new Session()
    inspector.connect()
    try {
      globalThis.fitbayTrayPrototype = Tray.prototype
      const { result } = await inspector.post('Runtime.evaluate', {
        expression: 'globalThis.fitbayTrayPrototype',
      })
      const { objects } = await inspector.post('Runtime.queryObjects', {
        prototypeObjectId: result.objectId,
      })
      const { result: count } = await inspector.post('Runtime.callFunctionOn', {
        objectId: objects.objectId,
        functionDeclaration:
          'function(){return this.filter(t=>{try{return !t.isDestroyed() && t.getBounds().width >= 0}catch{return false}}).length}',
        returnByValue: true,
      })
      if (count.value === undefined) throw Error(count.description)
      return count.value
    } finally {
      delete globalThis.fitbayTrayPrototype
      inspector.disconnect()
    }
  })
}
const b = (p, name) => p.getByRole('button', { name, exact: true })
try {
  const w = await host.firstWindow()
  w.on('pageerror', (error) => console.error(error.message))
  const job = 'shortcuts-00000000-0000-4000-a000-000000000000'
  await writeFile(path.join(profile, 'toolkit', job), 'null')
  kit = await _electron.launch({ args: [...args, '--fitbay-hosted', '--toolkit-page=' + job], env })
  await expect.poll(() => count(host)).toBe(1)
  assert.equal(await count(kit), 0)
  const independent = () => spawn(electron, args, { env, windowsHide: true, stdio: 'ignore' })
  independent()
  const p = await kit.firstWindow()
  await expect.poll(() => count(kit)).toBe(1)
  await b(w, '工作台设置').click()
  const light = w.locator('#material-brightness'),
    trans = w.locator('#material-transparency')
  await light.press('Home')
  await trans.press('Home')
  await expect
    .poll(() =>
      p.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--material-light').trim(),
      ),
    )
    .toBe('0')
  await expect
    .poll(() =>
      p.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--material-opacity').trim(),
      ),
    )
    .toBe('1')
  await p.screenshot({ path: path.join(profile, 'independent-dark.png') })
  await light.press('End')
  await trans.press('End')
  await expect
    .poll(() =>
      p.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--material-opacity').trim(),
      ),
    )
    .toBe('0')
  await expect
    .poll(() =>
      p.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--material-light').trim(),
      ),
    )
    .toBe('1')
  await p.setViewportSize({ width: 320, height: 620 })
  await b(p, '设置').click()
  await b(p, '设置分类').click()
  await b(p, 'API 与模型').click()
  const address = p.getByLabel('服务地址')
  await address.fill('https://example.invalid/' + 'long-path/'.repeat(20))

  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await p.screenshot({ path: path.join(profile, 'narrow-api.png') })
  await b(w, '关闭设置').click()
  await b(w, '组件').click()
  await w.locator('#window-menu').getByText('工具集', { exact: true }).click()
  const dock = w.locator('.toolkit-panel')
  await expect(b(dock, '框选屏幕')).toBeVisible()
  await expect.poll(() => count(kit)).toBe(0)
  await dock.screenshot({ path: path.join(profile, 'dock-home.png') })
  assert.equal(
    await dock.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  )
  await b(dock, '设置').click()
  await expect(dock.getByRole('region', { name: '屏幕取色' })).toBeVisible()
  await expect.poll(() => count(kit)).toBe(0)
  await expect(dock.getByRole('textbox').first()).toBeVisible()
  await expect
    .poll(() =>
      dock.evaluate(
        (el) => el.shadowRoot.querySelectorAll('style[data-make-styles-bucket]').length,
      ),
    )
    .toBeGreaterThan(0)
  const toggle = b(dock, '设置分类')
  if (await toggle.isVisible()) await toggle.click()
  await b(dock, 'API 与模型').click()
  await expect(dock.getByLabel('服务地址')).toBeVisible()
  for (const selector of [
    '.fitbay-settings-shell',
    '.fitbay-settings-body',
    '.fitbay-settings-content',
  ])
    assert.equal(
      await dock.locator(selector).evaluate((el) => getComputedStyle(el).outlineStyle),
      'none',
    )
  await dock.screenshot({ path: path.join(profile, 'dock-api.png') })
  await dock.getByLabel('服务地址').fill('https://example.invalid/')
  await b(dock, '返回').click()
  await expect(b(dock, '框选屏幕')).toBeVisible()
  assert.equal(await count(host), 1)
  assert.equal(await count(kit), 0)
  independent()
  await expect.poll(() => count(kit)).toBe(1)
  const second = await mkdtemp(path.resolve('tmp/toolkit-owner-'))
  await mkdir(path.join(second, 'toolkit'))
  await writeFile(path.join(second, 'toolkit', job), 'null')
  hostedOnly = await _electron.launch({
    args: [
      'components/toolkit',
      '--workbench-profile=' + second,
      '--fitbay-hosted',
      '--fitbay-owner-pid=' + host.process().pid,
      '--toolkit-page=' + job,
    ],
    env,
  })
  await expect.poll(() => count(hostedOnly)).toBe(0)
  const closed = hostedOnly.waitForEvent('close')
  await host.close()
  await closed
  assert.equal(await count(kit), 1)
  console.log('PASS hosted helper exits and independent home survives owner shutdown')
  console.log(
    'PASS Shell tray counts hosted 1+0, standalone 1+1, hosted 1+0, standalone 1+1; live material and settings focus',
    profile,
  )
} finally {
  await hostedOnly?.close()
  await kit?.close()
  await host.close()
}
