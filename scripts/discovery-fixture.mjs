import { expect } from '@playwright/test'

export async function openDiscovery(page, ai) {
  await page.getByRole('tab', { name: '找歌', exact: true }).click()
  const toggle = page.getByRole('button', { name: 'AI 推荐', exact: true })
  if ((await toggle.getAttribute('aria-pressed')) !== String(ai)) await toggle.click()
}

export async function openMusicSurface(app, docked) {
  const shell = await app.firstWindow()
  if (!docked) return shell
  await shell.getByRole('button', { name: '组件', exact: true }).click()
  const entry = shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true })
  if ((await entry.getAttribute('aria-checked')) === 'true') await entry.press('Escape')
  else await entry.click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const page = app.windows().find((p) => p.url().includes('/music/index.html'))
  await expect
    .poll(() => page.evaluate(async () => (await window.musicWindow.status()).mode))
    .toBe('docked')
  return page
}
