import { _electron, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { countLiveTrays } from './fitbay-tray-count.mjs'
const [hostExe, kitExe] = process.argv.slice(2)
if (!path.isAbsolute(hostExe ?? '') || !path.isAbsolute(kitExe ?? ''))
  throw Error(
    'Usage: node scripts/check-installed-toolkit-ownership.mjs ABSOLUTE_FITBAY_EXE ABSOLUTE_TOOLKIT_EXE',
  )
const root = await mkdtemp(path.join(await realpath('tmp'), 'installed-ownership-'))
const profile = path.join(root, 'profile'),
  job = 'shortcuts-00000000-0000-4000-a000-000000000000'
await mkdir(path.join(profile, 'toolkit'), { recursive: true })
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify(
    Object.fromEntries(
      ['capture', 'selection', 'color'].map((id, i) => [
        id,
        { key: 'Control+Alt+F' + (20 + i), enabled: false },
      ]),
    ),
  ),
)
await writeFile(path.join(profile, 'toolkit', job), 'null')
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
const taskbar = () =>
  JSON.parse(
    execFileSync('python', ['scripts/read-fitbay-taskbar.py'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  )
const sum = (rows) => rows.reduce((n, row) => n + row.count, 0)
const baseline = taskbar(),
  summary = { baseline, hostExe, kitExe }
let host, kit
try {
  host = await _electron.launch({
    executablePath: hostExe,
    args: ['--user-data-dir=' + profile],
    env,
  })
  const page = await host.firstWindow()
  page.setDefaultTimeout(7000)
  const b = (name) => page.getByRole('button', { name, exact: true })
  // Background launch hides the host's taskbar button; restore the shipping setting at its off-screen location.
  await host.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.hide()
    w.setFocusable(true)
    w.setSkipTaskbar(false)
    w.showInactive()
  })
  await expect.poll(() => sum(taskbar()) - sum(baseline), { timeout: 10000 }).toBe(1)
  summary.host = taskbar()
  kit = await _electron.launch({
    executablePath: kitExe,
    args: [
      '--workbench-profile=' + profile,
      '--fitbay-hosted',
      '--fitbay-owner-pid=' + host.process().pid,
      '--toolkit-page=' + job,
    ],
    env,
  })
  await b('工具集').click()
  await expect(page.locator('.dv-tab[data-tab-panel-id="component-toolkit"]')).toBeVisible()
  await expect.poll(() => countLiveTrays(host)).toBe(1)
  await expect.poll(() => countLiveTrays(kit)).toBe(0)
  summary.hosted = {
    tray: [await countLiveTrays(host), await countLiveTrays(kit)],
    buttons: taskbar(),
  }
  expect(sum(summary.hosted.buttons) - sum(baseline)).toBe(1)
  const closed = kit.waitForEvent('close', { timeout: 15000 })
  await host.close()
  host = null
  await closed
  kit = null
  summary.helperExitedWithHost = true
  console.log('PASS', root)
} finally {
  await writeFile(path.join(root, 'ownership.json'), JSON.stringify(summary, null, 2))
  await kit?.close().catch(() => {})
  await host?.close().catch(() => {})
}
