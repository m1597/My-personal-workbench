export async function openMusicSettings(page) {
  await page.getByRole('button', { name: '音乐设置', exact: true }).click()
}

export async function selectMusicSettings(page, name) {
  const nav = page.getByRole('navigation', { name: '设置分类', includeHidden: true })
  await nav.waitFor({ state: 'attached' })
  if (!(await nav.isVisible()))
    await page.getByRole('button', { name: '设置分类', exact: true }).click()
  await nav.getByRole('button', { name, exact: true }).click()
}
