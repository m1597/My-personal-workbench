import { _electron as electron, expect } from '@playwright/test'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, readFile, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createPromptActionReader } from '../examples/component-host/prompt-actions.mjs'

const root = path.resolve('dist/component-prototype')
const evidence = await mkdtemp(path.resolve('tmp/prompts-'))
console.log(evidence)
const profile = path.join(evidence, 'profile'),
  a = path.join(evidence, '默认'),
  b = path.join(evidence, '临时'),
  target = path.join(a, '解释推导.md')
await Promise.all([mkdir(a), mkdir(b)])
await writeFile(target, '# 解释推导\n初稿')
await writeFile(path.join(b, '临时.txt'), '临时')
const desktop = process.argv.includes('--desktop')
let app, external
async function launch() {
  app = await electron.launch({
    args: [
      path.join(root, 'host'),
      '--mode=prompts',
      '--user-data-dir=' + profile,
      '--workbench=' + path.join(root, 'workbench/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: desktop ? '0' : '1' },
  })
  return page('/prompts/index.html')
}
async function page(fragment) {
  await expect.poll(() => app.windows().some((p) => p.url().includes(fragment))).toBe(true)
  return app.windows().find((p) => p.url().includes(fragment))
}
async function choose(ui, button, folder) {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
  await ui.getByRole('button', { name: button, exact: true }).click()
}
try {
  let ui = await launch()
  await choose(ui, '设置默认目录', a)
  await ui.getByRole('button', { name: '解释推导.md' }).click()
  await expect(ui.getByText('初稿', { exact: false }).last()).toBeVisible()
  await rename(a, a + '.moved')
  await expect(ui.getByRole('button', { name: '解释推导.md' })).toHaveCount(0)
  await rename(a + '.moved', a)
  await expect(ui.getByRole('button', { name: '解释推导.md' })).toBeVisible()
  await writeFile(target, '外部修改一')
  await expect(ui.locator('.markdown')).toHaveText('外部修改一')
  await ui.getByRole('button', { name: '编辑', exact: true }).click()
  await ui.getByRole('textbox', { name: '提示词正文' }).fill('未保存草稿')
  await writeFile(target, '外部修改二')
  await expect(ui.getByRole('button', { name: '重新加载' })).toBeVisible()
  await expect(ui.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await expect(ui.getByRole('textbox', { name: '提示词正文' })).toHaveValue('未保存草稿')
  await ui.screenshot({ path: path.join(evidence, 'conflict.png') })
  await ui.getByRole('textbox', { name: '提示词正文' }).fill('外部修改一')
  await ui.getByRole('button', { name: '重新加载' }).click()
  await ui.getByRole('textbox', { name: '提示词正文' }).fill('逐步推导并解释每一步')
  await ui.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => readFile(target, 'utf8')).toBe('逐步推导并解释每一步')
  await ui.getByText('固定为工具集动作', { exact: true }).click()
  await ui.getByLabel('输入类型').selectOption('image')
  await ui.getByRole('button', { name: '固定动作', exact: true }).click()
  const reader = createPromptActionReader({ profile, installed: () => true })
  await expect.poll(async () => (await reader.listActions()).actions?.length).toBe(1)
  const [{ id, inputType }] = (await reader.listActions()).actions
  expect(inputType).toBe('image')
  expect((await reader.resolveAction(id)).action.template).toBe('逐步推导并解释每一步')
  await writeFile(target, '新版逐步推导并说明依据')
  expect((await reader.resolveAction(id)).action.template).toBe('新版逐步推导并说明依据')
  await rename(target, target + '.moved')
  expect((await reader.resolveAction(id)).error).toBe('FILE_UNAVAILABLE')
  await rename(target + '.moved', target)
  expect(
    (await createPromptActionReader({ profile, installed: () => false }).listActions()).error,
  ).toBe('COMPONENT_ABSENT')
  await choose(ui, '打开文件夹', b)
  await expect(ui.getByRole('button', { name: '临时.txt' })).toBeVisible()
  await app.close()
  ui = await launch()
  await ui.getByRole('button', { name: '解释推导.md' }).click()
  await expect(ui.locator('.markdown')).toHaveText('新版逐步推导并说明依据')
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setSize(395, 570))
  await ui.screenshot({ path: path.join(evidence, 'narrow.png') })
  await ui.getByRole('button', { name: '加入工作台' }).click()
  await expect(ui.getByRole('button', { name: '独立打开' })).toBeVisible()
  await ui.screenshot({ path: path.join(evidence, 'docked.png') })
  await ui.getByRole('button', { name: '独立打开' }).click()
  await expect(ui.getByRole('button', { name: '加入工作台' })).toBeVisible()
  const shell = await page('/workbench/index.html')
  await choose(ui, '打开文件夹', b)
  await expect(ui.getByRole('button', { name: '临时.txt' })).toBeVisible()
  await shell.evaluate(() => window.promptDock.stop())
  await shell.evaluate(() => window.promptDock.open())
  ui = await page('/prompts/index.html')
  await ui.getByRole('button', { name: '解释推导.md' }).click()
  await expect(ui.locator('.markdown')).toHaveText('新版逐步推导并说明依据')
  await ui.getByRole('button', { name: '编辑', exact: true }).click()
  await ui.getByRole('textbox', { name: '提示词正文' }).fill('测试关闭恢复')
  await shell.evaluate(() => window.promptDock.stop())
  await shell.evaluate(() => window.promptDock.open())
  ui = await page('/prompts/index.html')
  await ui.getByRole('button', { name: '解释推导.md' }).click()
  await expect(ui.getByRole('textbox', { name: '提示词正文' })).toHaveValue('测试关闭恢复')
  if (desktop) {
    await ui.getByText(/全局快捷键 ·/).click()
    await ui.getByRole('textbox', { name: '快捷键' }).fill('Control+Alt+Shift+F10')
    await ui.getByRole('button', { name: '应用快捷键' }).click()
    await expect(ui.getByRole('status')).toHaveText('快捷键已保存')
    const fixture = path.join(evidence, 'input.cjs')
    await writeFile(
      fixture,
      `const {app,BrowserWindow}=require('electron');let w;app.whenReady().then(async()=>{w=new BrowserWindow({width:400,height:220,title:'FitBay 验收输入框'});await w.loadURL('data:text/html,<title>FitBay QA</title><textarea autofocus></textarea>');w.focus()})`,
    )
    external = await electron.launch({
      args: [fixture, '--user-data-dir=' + path.join(evidence, 'external')],
    })
    const input = await external.firstWindow()
    await input.locator('textarea').focus()
    const hwnd = await external.evaluate(({ BrowserWindow }) =>
      Number(BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE()),
    )
    const user = createRequire(import.meta.url)('koffi').load('user32.dll')
    const fg = user.func('intptr_t __stdcall GetForegroundWindow()')
    // Activate only this test's external input window before synthesizing the hotkey.
    await input.bringToFront()
    await external.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.show()
      w.focus()
    })
    if (Number(fg()) !== hwnd) {
      await external.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setAlwaysOnTop(true),
      )
      const rect = Buffer.alloc(16)
      const cursor = Buffer.alloc(8)
      const position = user.func('int __stdcall SetCursorPos(int,int)')
      user.func('int __stdcall GetCursorPos(void *)')(cursor)
      user.func('int __stdcall GetWindowRect(intptr_t,void *)')(hwnd, rect)
      const x = rect.readInt32LE() + 65,
        y = rect.readInt32LE(4) + 80
      const hit = user.func('intptr_t __stdcall WindowFromPoint(int64_t)')(
        (BigInt(y >>> 0) << 32n) | BigInt(x >>> 0),
      )
      expect(Number(user.func('intptr_t __stdcall GetAncestor(intptr_t,uint32_t)')(hit, 2))).toBe(
        hwnd,
      )
      const click = user.func(
        'void __stdcall mouse_event(uint32_t,uint32_t,uint32_t,uint32_t,uintptr_t)',
      )
      position(x, y)
      click(2, 0, 0, 0, 0)
      click(4, 0, 0, 0, 0)
      position(cursor.readInt32LE(), cursor.readInt32LE(4))
      await external.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false),
      )
      await input.locator('textarea').focus()
    }
    await expect.poll(() => Number(fg())).toBe(hwnd)
    const key = user.func('void __stdcall keybd_event(uint8_t,uint8_t,uint32_t,uintptr_t)')
    for (const vk of [17, 18, 16, 121]) key(vk, 0, 0, 0)
    for (const vk of [121, 16, 18, 17]) key(vk, 0, 2, 0)
    const panel = await page('palette=1')
    await expect(panel.getByRole('textbox')).toBeFocused()
    await panel.getByRole('textbox').fill('依据')
    await expect(panel.getByRole('button', { name: /解释推导.md/ })).toContainText(
      '新版逐步推导并说明依据',
    )
    await panel.screenshot({ path: path.join(evidence, 'palette.png') })
    await panel.getByRole('textbox').press('Enter')
    await expect(input.locator('textarea')).toHaveValue('新版逐步推导并说明依据')
    await expect.poll(() => Number(fg())).toBe(hwnd)
    for (const vk of [17, 18, 16, 121]) key(vk, 0, 0, 0)
    for (const vk of [121, 16, 18, 17]) key(vk, 0, 2, 0)
    await expect(panel.getByRole('textbox')).toBeFocused()
    await external.close()
    external = undefined
    await panel.getByRole('textbox').fill('解释推导.md')
    await expect(panel.getByRole('button', { name: /解释推导.md/ })).toBeVisible()
    await panel.getByRole('textbox').press('Enter')
    await expect(panel.getByRole('status')).toContainText('已复制')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      '新版逐步推导并说明依据',
    )
  }
  console.log('PASS', desktop ? 'including foreground desktop paste' : 'background')
} finally {
  await external?.close()
  await app?.close()
}
