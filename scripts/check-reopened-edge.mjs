import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

const build = path.resolve(process.argv[2] || '.')
const evidence = await mkdtemp(path.resolve('tmp/reopen-edge-'))
const results = []
for (const axis of ['width', 'height']) {
  for (const end of [false, true]) {
    for (const reopen of ['same', 'new', 'neighbor']) {
      const key = [axis, end ? 'end' : 'start', reopen].join('-')
      const app = await electron.launch({
        args: [
          path.join(build, 'dist/component-prototype/host'),
          '--mode=workbench',
          '--component=' + path.join(build, 'dist/component-prototype/component'),
          '--workbench=' + path.join(build, 'out/renderer/index.html'),
          '--user-data-dir=' + path.join(evidence, key),
        ],
        env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
      })
      try {
        const page = await app.firstWindow()
        const button = (name) => page.getByRole('button', { name, exact: true })
        const open = async (name) => {
          await button('组件').click()
          await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
        }
        await open('示例组件')
        await expect
          .poll(() => app.windows().some((p) => p.url().includes('/component/index.html')))
          .toBe(true)
        const sample = app.windows().find((p) => p.url().includes('/component/index.html'))
        const field = sample.getByLabel('保留输入')
        await field.fill(key)
        await open('工具集')
        const groups = page.locator('.dv-groupview:visible')
        await expect(groups).toHaveCount(2)
        if (axis === 'height') {
          await button('布局').click()
          await page.getByRole('menuitem', { name: '上下并排' }).click()
        }
        const sizes = () =>
          page.locator('[data-repeat-split]').evaluate((split, axis) => {
            const rect = split.getBoundingClientRect()
            const views = [...split.querySelectorAll(':scope > .dv-view-container > .dv-view')].map(
              (el) => el.getBoundingClientRect(),
            )
            const visible = views.filter((r) => r[axis] > 0)
            const start = axis === 'width' ? 'left' : 'top'
            const end = axis === 'width' ? 'right' : 'bottom'
            return {
              span: rect[axis],
              panes: views.map((r) => r[axis]),
              gaps: [visible[0][start] - rect[start], rect[end] - visible.at(-1)[end]],
            }
          }, axis)
        const drag = async () => {
          const h = await page.locator('.dv-sash.dv-enabled').evaluateAll(
            (els, { axis, end }) => {
              document.querySelector('[data-repeat-split]')?.removeAttribute('data-repeat-split')
              const sash = els.find((el) => {
                const b = el.getBoundingClientRect()
                return b.width && b.height && b.height > b.width === (axis === 'width')
              })
              if (!sash) throw Error('No draggable separator on ' + axis)
              const split = sash.parentElement.parentElement
              split.dataset.repeatSplit = '1'
              const box = split.getBoundingClientRect(),
                bar = sash.getBoundingClientRect()
              const pane = [...split.querySelectorAll(':scope > .dv-view-container > .dv-view')].at(
                end ? -1 : 0,
              )
              return {
                x: bar.x + bar.width / 2,
                y: bar.y + bar.height / 2,
                endpoint:
                  axis === 'width'
                    ? end
                      ? box.right - 16
                      : box.left + 16
                    : end
                      ? box.bottom - 16
                      : box.top + 16,
                id: pane.querySelector('.dv-tab[aria-selected=true]')?.dataset.tabPanelId,
              }
            },
            { axis, end },
          )
          await page.mouse.move(h.x, h.y)
          await page.mouse.down()
          await page.mouse.move(
            axis === 'width' ? h.endpoint : h.x,
            axis === 'height' ? h.endpoint : h.y,
            { steps: 18 },
          )
          await page.mouse.up()
          await expect.poll(async () => (await sizes()).panes.at(end ? -1 : 0)).toBe(0)
          const s = await sizes()
          for (const gap of s.gaps) expect(Math.abs(gap)).toBeLessThanOrEqual(1)
          return { id: h.id, ...s }
        }
        const first = await drag()
        const hiddenName = { 'component-example': '示例组件', 'component-toolkit': '工具集' }[
          first.id
        ]
        const name =
          reopen === 'new'
            ? '提示词库'
            : reopen === 'same'
              ? hiddenName
              : hiddenName === '示例组件'
                ? '工具集'
                : '示例组件'
        await open(name)
        const selected = {
          提示词库: 'component-prompts',
          工具集: 'component-toolkit',
          示例组件: 'component-example',
        }[name]
        await expect(
          groups.locator(`[data-tab-panel-id="${selected}"][aria-selected=true]`),
        ).toBeVisible()
        const beforeSecond = await groups.count()
        const instances = () =>
          app.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter((w) => /\/(component|prompts)\/index\.html/.test(w.getURL()))
              .map((w) => w.id)
              .sort(),
          )
        const beforeIds = await instances()
        const second = await drag()
        await page.screenshot({ path: path.join(evidence, key + '.png') })
        await button('布局').click()
        await page
          .getByRole('menuitem', { name: /恢复分屏/ })
          .last()
          .click()
        await expect(groups.locator(`[data-tab-panel-id="${selected}"]`)).toBeVisible()
        await expect(groups).toHaveCount(beforeSecond)
        expect(await instances()).toEqual(beforeIds)
        await expect(field).toHaveValue(key)
        expect(app.windows().filter((p) => p.url().includes('/component/index.html'))).toEqual([
          sample,
        ])
        results.push({ key, first, second, contentRetained: true })
      } catch (e) {
        results.push({ key, error: e.message.split('Call log:')[0] })
      } finally {
        await app.close()
        console.log(key, results.at(-1).error || 'PASS')
        await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
      }
    }
  }
}
console.log(evidence)
if (results.some((r) => r.error)) process.exitCode = 1
