import { countLiveTrays as count } from './fitbay-tray-count.mjs'
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
  async function checkRows(page, surface, name) {
    const rows = surface.locator('.tool-row')
    await expect(rows).toHaveCount(3)
    const metrics = await rows.evaluateAll((items) =>
      items.map((item) => {
        const badge = item.querySelector('.badge'),
          svg = badge.querySelector('svg'),
          action = item.querySelector('button')
        return {
          label: badge.getAttribute('aria-label'),
          background: getComputedStyle(badge).backgroundColor,
          stroke: getComputedStyle(svg).stroke,
          width: svg.getBoundingClientRect().width,
          right: action.getBoundingClientRect().right,
          gap:
            action.getBoundingClientRect().left -
            item.querySelector('.tool-text').getBoundingClientRect().right,
        }
      }),
    )
    for (const m of metrics) {
      assert(m.label && m.gap >= 0)
      assert.equal(m.background, 'rgba(0, 0, 0, 0)')
      assert.equal(m.stroke, 'rgb(255, 255, 255)')
      assert.equal(m.width, 27)
      assert(Math.abs(m.right - metrics[0].right) < 1)
    }
    await b(surface, '设置').hover()
    await expect(surface.getByRole('tooltip')).toBeVisible()
    await expect(b(surface, '框选屏幕')).toBeDisabled()
    await page.screenshot({ path: path.join(profile, name + '.png') })
  }
  for (const width of [850, 600, 320]) {
    await p.setViewportSize({ width, height: 620 })
    await checkRows(p, p, 'standalone-' + width)
  }
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
  await checkRows(w, dock, 'dock-home')
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
  const choice = dock.getByRole('combobox', { name: '用途' })
  await choice.click()
  await expect(dock.getByRole('option', { name: '视觉问答' })).toBeVisible()
  await dock.screenshot({ path: path.join(profile, 'dock-api-open.png') })
  await choice.press('Escape')
  await dock.screenshot({ path: path.join(profile, 'dock-api.png') })
  await dock.getByLabel('服务地址').fill('https://example.invalid/')
  await b(dock, '返回').click()
  await expect(b(dock, '框选屏幕')).toBeVisible()
  assert.equal(await count(host), 1)
  assert.equal(await count(kit), 0)
  await b(w, '组件').click()
  await w.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
  await expect
    .poll(() => host.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const music = host.windows().find((p) => p.url().includes('/music/index.html'))
  await b(music, '跳过').click()
  const musicGear = b(music, '音乐设置')
  await musicGear.hover()
  await music.screenshot({ path: path.join(profile, 'music-home.png') })
  async function geometry(control) {
    return control.evaluate((n) => {
      const r = n.getBoundingClientRect()
      return { width: r.width, height: r.height, path: n.querySelector('path')?.getAttribute('d') }
    })
  }
  const reference = await geometry(musicGear),
    toolkit = await geometry(b(dock, '设置'))
  assert.deepEqual(toolkit, reference)
  await writeFile(
    path.join(profile, 'gear.json'),
    JSON.stringify({ music: reference, toolkit }, null, 2),
  )
  await musicGear.click()
  await music.screenshot({ path: path.join(profile, 'music-settings.png') })
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
