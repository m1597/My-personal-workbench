import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const folder = await mkdtemp(path.resolve('tmp/toolkit-browser-selection-'))
if (!process.env.FITBAY_TEST_DESKTOP?.startsWith('FitBayTest'))
  throw Error('Private desktop required')
const python = (code, ...args) =>
  execFileSync('python', ['-c', code, ...args], { encoding: 'utf8' }).trim()
python(`import os,ctypes as c,win32api,win32service as s
buf=c.create_unicode_buffer(256)
assert c.windll.user32.GetUserObjectInformationW(int(s.GetThreadDesktop(win32api.GetCurrentThreadId())),2,buf,512,None)
assert buf.value==os.environ['FITBAY_TEST_DESKTOP']`)
const browser = await chromium.launchPersistentContext(path.join(folder, 'chrome'), {
  channel: 'chrome',
  headless: false,
  args: ['--force-renderer-accessibility', '--disable-background-networking', '--no-first-run'],
})
try {
  const page = browser.pages()[0]
  const expected = 'Exact middle sentence.'
  await page.setContent(
    '<title>FitBayRangeFixture</title><p>Prefix outside selection. Exact middle sentence. Suffix outside selection.</p>',
  )
  await page.locator('p').evaluate((p, expected) => {
    const t = p.firstChild,
      from = t.textContent.indexOf(expected),
      r = document.createRange()
    r.setStart(t, from)
    r.setEnd(t, from + expected.length)
    const sel = getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
  }, expected)
  assert.equal(await page.evaluate(() => getSelection().toString()), expected)
  const hwnd = python(`import win32gui,win32service,win32api,time
desk=win32service.GetThreadDesktop(win32api.GetCurrentThreadId())
for i in range(30):
 a=[h for h in desk.EnumDesktopWindows() if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h)=='Chrome_WidgetWin_1']
 if len(a)==1:break
 time.sleep(.05)
assert len(a)==1,a
print(int(a[0]))`)
  function read(value) {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/check-toolkit-selection-range.ps1',
        '-BrowserWindow',
        hwnd,
        '-Expected',
        value,
      ],
      { stdio: 'inherit', timeout: 12000 },
    )
  }
  read(expected)
  const pdf = path.join(folder, 'FitBayRangeFixture.pdf')
  python(
    "from reportlab.pdfgen.canvas import Canvas;import sys;c=Canvas(sys.argv[1]);c.drawString(40,740,'Exact middle sentence.');c.save()",
    pdf,
  )
  await page.goto(pathToFileURL(pdf).href, { waitUntil: 'commit' })
  await page.waitForTimeout(1600)
  await page.mouse.click(450, 240)
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(200)
  read(expected)
  console.log('PASS Chrome HTML and PDF selections', folder)
} finally {
  await browser.close()
}
